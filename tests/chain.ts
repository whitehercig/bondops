import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createTransferInstruction } from "@solana/spl-token";
import {
  COUPON,
  REDEMPTION,
  VOTE,
  LOCAL_RPC,
  createDemo,
  program,
  fetchState,
  schedule,
  snapshot,
  fund,
  reclaimExcess,
  settle,
  transfer,
  vote,
  finalizeVote,
  chainTime,
  bondVault,
  describeError,
  PROGRAM_ID,
} from "../app/src/client";
import type { Receipt } from "../app/src/client";

const { BN } = anchor;
const connection = new Connection(LOCAL_RPC, "confirmed");
const receipts: Receipt[] = [];
const results: { name: string; ok: boolean }[] = [];
const pass = (name: string) => {
  results.push({ name, ok: true });
  console.log(`✓ ${name}`);
};
async function rejected(
  name: string,
  fn: () => Promise<unknown>,
  message: RegExp,
) {
  await assert.rejects(fn, (e: unknown) => {
    const text = describeError(e);
    assert.match(text, message, name);
    return true;
  });
  pass(name);
}
async function waitUntil(timestamp: number) {
  const deadline = Date.now() + 120_000;
  while ((await chainTime(connection)) < timestamp) {
    if (Date.now() > deadline) throw new Error("Validator clock timeout");
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}
const record = (label: string, signature: string) =>
  receipts.push({ label, signature, at: Date.now() });

console.log(
  "BondOps · executing real transactions on the local Solana validator",
);
const s = await createDemo(LOCAL_RPC, (r) => receipts.push(r), 30, 2);
let state = await fetchState(s);
assert.equal(state.supply, 20n);
assert.equal(state.custody, 20n);
assert.deepEqual(
  state.instrument.holders.map((h) => h.quantity.toNumber()),
  [10, 6, 4],
);
pass("Real SPL bond mint, custody and holder registry reconcile");
const p = program(connection, s.issuer);
await rejected(
  "Issuance cannot reopen after seal",
  () =>
    p.methods
      .issue(s.investors[0].publicKey, new BN(1))
      .accountsStrict({
        issuer: s.issuer.publicKey,
        instrument: s.instrument,
        bondMint: s.bondMint,
        bondVault: bondVault(s.instrument),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc(),
  /Issuance is closed/,
);
await rejected(
  "Holder cannot transfer another holder’s position",
  () =>
    p.methods
      .transferPosition(s.investors[1].publicKey, new BN(1))
      .accountsStrict({ owner: s.issuer.publicKey, instrument: s.instrument })
      .rpc(),
  /Unknown holder/,
);
await rejected(
  "Insufficient position is rejected",
  () => transfer(s, 0, s.investors[1].publicKey, 11),
  /Insufficient position/,
);
await rejected(
  "Zero-quantity transfers are rejected",
  () => transfer(s, 0, s.investors[1].publicKey, 0),
  /Invalid position/,
);
await rejected(
  "Issuer cannot withdraw custody tokens with its own signature",
  async () =>
    p.provider.sendAndConfirm!(
      new Transaction().add(
        createTransferInstruction(
          bondVault(s.instrument),
          bondVault(s.instrument),
          s.issuer.publicKey,
          1n,
        ),
      ),
    ),
  /owner does not match|OwnerMismatch|custom program error: 0x4/i,
);
await rejected(
  "Redemption requires all final coupon snapshots to be scheduled",
  () => schedule(s, REDEMPTION),
  /final coupon/i,
);

let now = await chainTime(connection);
const ballot = await schedule(
  s,
  VOTE,
  now + 10,
  10,
  "Approve quarterly reporting.",
);
record("Schedule voting", ballot.signature);
await rejected(
  "Only issuer may schedule corporate actions",
  () =>
    program(connection, s.investors[0])
      .methods.seal()
      .accountsStrict({
        issuer: s.investors[0].publicKey,
        instrument: s.instrument,
      })
      .rpc(),
  /has one constraint|ConstraintHasOne/i,
);
const coupon1 = await schedule(s, COUPON);
record("Queue coupon 1", coupon1.signature);
const coupon2 = await schedule(s, COUPON);
record("Queue final coupon", coupon2.signature);
const redemption = await schedule(s, REDEMPTION);
record("Queue maturity redemption", redemption.signature);
state = await fetchState(s);
assert.equal(state.actions.length, 4);
assert.ok(state.instrument.pendingAction.equals(ballot.address));
pass("All future contractual actions are queued in advance");
await rejected(
  "Later action cannot snapshot ahead of an earlier record",
  () => snapshot(s, coupon1.address),
  /Invalid corporate action/,
);
await rejected(
  "Redemption can only be scheduled once",
  () => schedule(s, REDEMPTION),
  /Invalid corporate action/,
);
await rejected(
  "Early snapshots are rejected",
  () => snapshot(s, ballot.address),
  /has not arrived/,
);
await waitUntil(now + 10);
await rejected(
  "A late executor cannot permit post-record transfers",
  () => transfer(s, 0, s.investors[1].publicKey, 4),
  /transfers locked/,
);
record("Snapshot voting rights", await snapshot(s, ballot.address));
state = await fetchState(s);
assert.deepEqual(
  state.actions[0].entries.map((e) => e.quantity.toNumber()),
  [10, 6, 4],
);
assert.ok(state.actions[0].snapshotSlot.gtn(0));
pass("Complete voting snapshot and slot persist on-chain");
await rejected(
  "Snapshot cannot be rewritten",
  () => snapshot(s, ballot.address),
  /Invalid corporate action/,
);
record(
  "Transfer 4 bonds after voting record",
  await transfer(s, 0, s.investors[1].publicKey, 4),
);
record(
  "Aida votes yes with original weight",
  await vote(s, ballot.address, 0, 0, true),
);
await rejected(
  "Wrong owner cannot cast a ballot",
  () => vote(s, ballot.address, 1, 0, true),
  /recorded beneficiary/,
);
await rejected(
  "Same holder cannot vote twice",
  () => vote(s, ballot.address, 0, 0, false),
  /already voted/,
);
record("Timur votes no", await vote(s, ballot.address, 1, 1, false));
state = await fetchState(s);
assert.equal(state.actions[0].yesWeight.toNumber(), 10);
assert.equal(state.actions[0].noWeight.toNumber(), 6);
pass("Transfers do not migrate or multiply snapshot voting rights");
await rejected(
  "Vote cannot be finalized before close",
  () => finalizeVote(s, ballot.address),
  /has not arrived/,
);

await waitUntil(now + 20);
record("Finalize voting", await finalizeVote(s, ballot.address));
state = await fetchState(s);
assert.equal(state.actions[0].quorumMet, true);
assert.equal(state.actions[0].passed, true);
pass("50% quorum and strict majority are enforced on-chain");
await rejected(
  "Voting cannot resume after finalization",
  () => vote(s, ballot.address, 2, 2, true),
  /Invalid corporate action/,
);

console.log("Waiting for the contract’s first coupon record date…");
await waitUntil(state.instrument.startedAt.toNumber() + 30);
record("Snapshot coupon 1", await snapshot(s, coupon1.address));
state = await fetchState(s);
let a = state.actions[1];
assert.deepEqual(
  a.entries.map((e) => e.amount.toNumber()),
  [300_000_000, 500_000_000, 200_000_000],
);
assert.equal(a.totalDue.toString(), "1000000000");
pass("Coupon entitlement = quantity × face × annual bps / (10000 × frequency)");
record(
  "Transfer 2 bonds after coupon record",
  await transfer(s, 1, s.investors[0].publicKey, 2),
);
state = await fetchState(s);
assert.deepEqual(
  state.instrument.holders.map((h) => h.quantity.toNumber()),
  [8, 8, 4],
);
assert.deepEqual(
  state.actions[1].entries.map((e) => e.quantity.toNumber()),
  [6, 10, 4],
);
pass("Coupon entitlements remain immutable after position transfers");
await rejected(
  "Underfunded action cannot pay its first holder",
  () => settle(s, coupon1.address, 0, s.investors[0].publicKey),
  /complete outstanding obligation/,
);
record("Partially fund coupon 1", await fund(s, coupon1.address, 500_000_000n));
await rejected(
  "Partial funding still cannot cause selective settlement",
  () => settle(s, coupon1.address, 0, s.investors[0].publicKey),
  /complete outstanding obligation/,
);
record(
  "Fully fund coupon 1 with surplus",
  await fund(s, coupon1.address, 500_000_001n),
);
await rejected(
  "Issuer cannot reclaim reserved cash before completion",
  () => reclaimExcess(s, coupon1.address),
  /Invalid corporate action/,
);
await rejected(
  "Funds cannot be redirected to a different beneficiary",
  () => settle(s, coupon1.address, 0, s.investors[1].publicKey),
  /recorded beneficiary/,
);
record(
  "Settle first coupon holder",
  await settle(s, coupon1.address, 0, s.investors[0].publicKey),
);
await rejected(
  "Duplicate payment is rejected",
  () => settle(s, coupon1.address, 0, s.investors[0].publicKey),
  /already settled/,
);
// A fresh client with another executor resumes from durable on-chain flags.
state = await fetchState(s);
for (const [index, e] of state.actions[1].entries.entries())
  if (!e.paid)
    record(
      "Resume coupon settlement with investor executor",
      await settle(s, coupon1.address, index, e.owner, s.investors[2]),
    );
state = await fetchState(s);
assert.equal(state.actions[1].status, 2);
assert.equal(
  state.actions[1].totalPaid.toString(),
  state.actions[1].totalDue.toString(),
);
assert.deepEqual(state.cash, [300_000_000n, 500_000_000n, 200_000_000n]);
pass("Fresh executor resumes partial settlement without double payment");
record(
  "Reclaim one-microunit surplus",
  await reclaimExcess(s, coupon1.address),
);
state = await fetchState(s);
assert.equal(state.actions[1].funded, 0n);
pass("Only completed actions release surplus funding back to issuer");

await waitUntil(state.instrument.maturity.toNumber());
await rejected(
  "Maturity automatically locks transfers",
  () => transfer(s, 0, s.investors[1].publicKey, 1),
  /matured/,
);
record("Snapshot final coupon", await snapshot(s, coupon2.address));
record("Fund final coupon", await fund(s, coupon2.address, 1_000_000_000n));
state = await fetchState(s);
for (const [index, e] of state.actions[2].entries.entries())
  record(
    "Settle final coupon",
    await settle(s, coupon2.address, index, e.owner),
  );
await rejected(
  "A coupon cannot be scheduled twice or beyond contractual count",
  () => schedule(s, COUPON),
  /All coupons/,
);

record("Snapshot redemption", await snapshot(s, redemption.address));
await rejected(
  "Unfunded redemption leaves bond supply intact",
  () => settle(s, redemption.address, 0, s.investors[0].publicKey),
  /complete outstanding obligation/,
);
state = await fetchState(s);
assert.equal(state.supply, 20n);
assert.equal(state.instrument.outstanding.toNumber(), 20);
pass("Failed redemption rolls back registry changes and token burn");
record("Fund redemption", await fund(s, redemption.address, 20_000_000_000n));
await rejected(
  "Wrong redemption payee cannot burn the holder’s bonds",
  () => settle(s, redemption.address, 0, s.investors[1].publicKey),
  /recorded beneficiary/,
);
state = await fetchState(s);
for (const [index, e] of state.actions[3].entries.entries())
  record(
    "Atomic principal payment and burn",
    await settle(s, redemption.address, index, e.owner),
  );
state = await fetchState(s);
assert.equal(state.supply, 0n);
assert.equal(state.custody, 0n);
assert.equal(state.instrument.outstanding.toNumber(), 0);
assert.equal(state.instrument.phase, 2);
assert.equal(state.actions[3].burnedQuantity.toNumber(), 20);
assert.deepEqual(state.cash, [8_700_000_000n, 8_900_000_000n, 4_400_000_000n]);
pass("Principal is paid and every corresponding token is burned atomically");
await rejected(
  "Completed redemption cannot pay or burn again",
  () => settle(s, redemption.address, 0, s.investors[0].publicKey),
  /Invalid corporate action/,
);
await rejected(
  "Redeemed instrument cannot schedule new actions",
  async () =>
    schedule(s, VOTE, (await chainTime(connection)) + 10, 10, "Reopen"),
  /already redeeming/,
);
pass(
  "Coupon + voting + redemption lifecycle reconciles to zero outstanding supply",
);
mkdirSync(".local", { recursive: true });
writeFileSync(
  ".local/test-evidence.json",
  JSON.stringify(
    {
      program: PROGRAM_ID.toString(),
      instrument: s.instrument.toString(),
      network: LOCAL_RPC,
      generatedAt: new Date().toISOString(),
      tests: results,
      finalSupply: state.supply.toString(),
      finalCashMicrounits: state.cash.map(String),
      receipts,
    },
    null,
    2,
  ),
);
console.log(
  `\n${results.length} checks passed. Evidence: .local/test-evidence.json`,
);
