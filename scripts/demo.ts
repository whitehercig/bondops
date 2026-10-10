import { Connection } from "@solana/web3.js";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  LOCAL_RPC,
  COUPON,
  REDEMPTION,
  VOTE,
  createDemo,
  fetchState,
  schedule,
  snapshot,
  fund,
  settle,
  transfer,
  vote,
  finalizeVote,
  chainTime,
  titleFor,
  PROGRAM_ID,
} from "../app/src/client";
import type { Receipt } from "../app/src/client";

const rpc = process.env.BONDOPS_RPC || LOCAL_RPC;
if (![LOCAL_RPC, "https://api.devnet.solana.com"].includes(rpc))
  throw new Error("Demo only supports localnet and devnet.");
const c = new Connection(rpc, "confirmed");
const receipts: Receipt[] = [];
const record = (label: string, signature: string) => {
  receipts.push({ label, signature, at: Date.now() });
  console.log(`${label}: ${signature}`);
};
const s = await createDemo(rpc, (r) => record(r.label, r.signature), 35, 2);
async function waitUntil(t: number) {
  const deadline = Date.now() + 180_000;
  while ((await chainTime(c)) < t) {
    if (Date.now() > deadline) throw new Error("Clock timeout");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
const now = await chainTime(c);
const ballot = await schedule(
  s,
  VOTE,
  now + 5,
  10,
  "Approve quarterly reporting.",
);
record("Schedule reporting vote", ballot.signature);
await waitUntil(now + 5);
record("Snapshot voting rights", await snapshot(s, ballot.address));
for (let index = 0; index < 3; index++)
  record(
    `Vote investor ${index + 1}`,
    await vote(s, ballot.address, index, index, index !== 1),
  );
const coupon1 = await schedule(s, COUPON);
record("Queue first coupon", coupon1.signature);
const coupon2 = await schedule(s, COUPON);
record("Queue final coupon", coupon2.signature);
const redemption = await schedule(s, REDEMPTION);
record("Queue redemption", redemption.signature);
await waitUntil(now + 15);
record("Finalize reporting vote", await finalizeVote(s, ballot.address));
let state = await fetchState(s);
await waitUntil(state.instrument.startedAt.toNumber() + 35);
record("Snapshot coupon 1", await snapshot(s, coupon1.address));
record(
  "Transfer four bonds after record date",
  await transfer(s, 0, s.investors[1].publicKey, 4),
);
for (let number = 1; number <= 2; number++) {
  const action = number === 1 ? coupon1 : coupon2;
  if (number === 2) {
    await waitUntil(state.instrument.maturity.toNumber());
    record("Snapshot final coupon", await snapshot(s, action.address));
  }
  record(
    `Fund coupon ${number}`,
    await fund(s, action.address, 1_000_000_000n),
  );
  state = await fetchState(s);
  const a = state.actions.find((a) => a.address.equals(action.address))!;
  for (const [index, e] of a.entries.entries())
    record(
      `${titleFor(a)} · holder ${index + 1}`,
      await settle(s, a.address, index, e.owner),
    );
}

record("Snapshot principal rights", await snapshot(s, redemption.address));
record("Fund principal", await fund(s, redemption.address, 20_000_000_000n));
state = await fetchState(s);
for (const [index, e] of state.actions.at(-1)!.entries.entries())
  record(
    `Atomic redemption · holder ${index + 1}`,
    await settle(s, redemption.address, index, e.owner),
  );
state = await fetchState(s);
mkdirSync("docs/evidence", { recursive: true });
writeFileSync(
  "docs/evidence/demo.json",
  JSON.stringify(
    {
      program: PROGRAM_ID.toString(),
      instrument: s.instrument.toString(),
      network: rpc,
      generatedAt: new Date().toISOString(),
      finalSupply: state.supply.toString(),
      finalCashMicrounits: state.cash.map(String),
      actions: state.actions.map((a) => ({
        address: a.address.toString(),
        name: titleFor(a),
        recordAt: a.recordAt.toString(),
        snapshotSlot: a.snapshotSlot.toString(),
        totalDue: a.totalDue.toString(),
        totalPaid: a.totalPaid.toString(),
        burned: a.burnedQuantity.toString(),
        passed: a.passed,
      })),
      receipts,
    },
    null,
    2,
  ),
);
console.log(
  "\nLifecycle complete. Bond supply:",
  state.supply.toString(),
  "\nEvidence: docs/evidence/demo.json",
);
