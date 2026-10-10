import { AnchorProvider, Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import type { Idl, Wallet } from "@coral-xyz/anchor";
import type BNType from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  MINT_SIZE,
  getAccount,
  getMint,
} from "@solana/spl-token";
import { Buffer } from "buffer";
import idl from "./idl.json";

export const PROGRAM_ID = new PublicKey(idl.address);
export const LOCAL_RPC = "http://127.0.0.1:18999";
export const DEVNET_RPC = "https://api.devnet.solana.com";
export const COUPON = 0,
  REDEMPTION = 1,
  VOTE = 2;

export type Holding = { owner: PublicKey; quantity: BNType };
export type Entry = Holding & {
  amount: BNType;
  paid: boolean;
  voted: boolean;
  support: boolean;
  settledAt: BNType;
};
export type Instrument = {
  id: BNType;
  issuer: PublicKey;
  bondMint: PublicKey;
  paymentMint: PublicKey;
  faceValue: BNType;
  annualBps: number;
  frequency: number;
  periods: number;
  intervalSeconds: BNType;
  startedAt: BNType;
  maturity: BNType;
  outstanding: BNType;
  sealed: boolean;
  phase: number;
  couponsScheduled: number;
  nextAction: BNType;
  pendingRecord: BNType;
  pendingAction: PublicKey;
  label: string;
  holders: Holding[];
  redemptionScheduled: boolean;
};
export type Action = {
  instrument: PublicKey;
  nonce: BNType;
  kind: number;
  status: number;
  recordAt: BNType;
  closeAt: BNType;
  amountPerBond: BNType;
  couponNumber: number;
  snapshotSlot: BNType;
  snapshotAt: BNType;
  totalQuantity: BNType;
  totalDue: BNType;
  totalPaid: BNType;
  burnedQuantity: BNType;
  yesWeight: BNType;
  noWeight: BNType;
  quorumMet: boolean;
  passed: boolean;
  proposal: string;
  entries: Entry[];
};
export type ActionRecord = Action & { address: PublicKey; funded: bigint };
export type ChainState = {
  instrument: Instrument;
  actions: ActionRecord[];
  supply: bigint;
  custody: bigint;
  cash: bigint[];
  now: number;
};
export type DemoSession = {
  issuer: Keypair;
  investors: Keypair[];
  instrument: PublicKey;
  paymentMint: PublicKey;
  bondMint: PublicKey;
  rpc: string;
};
export type Receipt = { label: string; signature: string; at: number };

export function keypairWallet(keypair: Keypair): Wallet {
  return {
    publicKey: keypair.publicKey,
    payer: keypair,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      tx: T,
    ): Promise<T> {
      if (tx instanceof Transaction) tx.partialSign(keypair);
      else tx.sign([keypair]);
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(
      txs: T[],
    ): Promise<T[]> {
      for (const tx of txs) {
        if (tx instanceof Transaction) tx.partialSign(keypair);
        else tx.sign([keypair]);
      }
      return txs;
    },
  };
}

export function program(connection: Connection, signer: Keypair) {
  const provider = new AnchorProvider(connection, keypairWallet(signer), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new Program(idl as Idl, provider);
}
const bytes = (n: BNType | number) => new BN(n).toArrayLike(Buffer, "le", 8);
export const instrumentAddress = (issuer: PublicKey, id: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("instrument"), issuer.toBuffer(), bytes(id)],
    PROGRAM_ID,
  )[0];
export const bondVault = (instrument: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("bond-vault"), instrument.toBuffer()],
    PROGRAM_ID,
  )[0];
export const actionAddress = (instrument: PublicKey, nonce: BNType | number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("action"), instrument.toBuffer(), bytes(nonce)],
    PROGRAM_ID,
  )[0];
export const paymentVault = (action: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("payment-vault"), action.toBuffer()],
    PROGRAM_ID,
  )[0];
export const cashAccount = (mint: PublicKey, owner: PublicKey) =>
  getAssociatedTokenAddressSync(mint, owner);

export async function chainTime(connection: Connection): Promise<number> {
  const slot = await connection.getSlot("confirmed");
  const time = await connection.getBlockTime(slot);
  if (time == null)
    throw new Error(
      "RPC did not return an on-chain timestamp. Retry after the next block.",
    );
  return time;
}

export async function createDemo(
  rpc: string,
  onReceipt: (r: Receipt) => void,
  interval = 90,
  periods = 2,
): Promise<DemoSession> {
  const connection = new Connection(rpc, "confirmed");
  const account = await connection.getAccountInfo(PROGRAM_ID);
  if (!account?.executable)
    throw new Error(
      "BondOps program is not deployed to this network. Run npm run localnet first, or deploy to devnet.",
    );
  const issuer = Keypair.generate();
  const investors = [
    Keypair.generate(),
    Keypair.generate(),
    Keypair.generate(),
  ];
  const sig = await connection.requestAirdrop(
    issuer.publicKey,
    2 * LAMPORTS_PER_SOL,
  );
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    { signature: sig, ...latest },
    "confirmed",
  );
  const p = program(connection, issuer);
  const record = (label: string, signature: string) =>
    onReceipt({ label, signature, at: Date.now() });
  // Demo funds and keys are generated for this session; no real payment asset.
  const paymentMint = Keypair.generate();
  const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const moneyTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: issuer.publicKey,
      newAccountPubkey: paymentMint.publicKey,
      lamports: rent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      paymentMint.publicKey,
      6,
      issuer.publicKey,
      null,
    ),
    ...investors.map((k) =>
      SystemProgram.transfer({
        fromPubkey: issuer.publicKey,
        toPubkey: k.publicKey,
        lamports: 5_000_000,
      }),
    ),
    ...[issuer, ...investors].map((k) =>
      createAssociatedTokenAccountIdempotentInstruction(
        issuer.publicKey,
        cashAccount(paymentMint.publicKey, k.publicKey),
        k.publicKey,
        paymentMint.publicKey,
      ),
    ),
    createMintToInstruction(
      paymentMint.publicKey,
      cashAccount(paymentMint.publicKey, issuer.publicKey),
      issuer.publicKey,
      100_000_000_000n,
    ),
  );
  record(
    "Create DemoUSD and investor payment accounts",
    await p.provider.sendAndConfirm!(moneyTx, [paymentMint]),
  );
  const bondMint = Keypair.generate();
  const id = Math.floor(Date.now() / 1000);
  const instrument = instrumentAddress(issuer.publicKey, id);
  record(
    "Create instrument and program custody",
    await p.methods
      .initialize(
        new BN(id),
        new BN(1_000_000_000),
        1000,
        2,
        periods,
        new BN(interval),
        "Kazakhstan Infrastructure · Demo Bond",
      )
      .accountsStrict({
        issuer: issuer.publicKey,
        instrument,
        bondMint: bondMint.publicKey,
        paymentMint: paymentMint.publicKey,
        bondVault: bondVault(instrument),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([bondMint])
      .rpc(),
  );
  for (const [n, quantity] of [10, 6, 4].entries()) {
    record(
      `Issue ${quantity} bonds to ${["Aida", "Timur", "Dana"][n]}`,
      await p.methods
        .issue(investors[n].publicKey, new BN(quantity))
        .accountsStrict({
          issuer: issuer.publicKey,
          instrument,
          bondMint: bondMint.publicKey,
          bondVault: bondVault(instrument),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
    );
  }
  record(
    "Seal issuance · fixed supply",
    await p.methods
      .seal()
      .accountsStrict({ issuer: issuer.publicKey, instrument })
      .rpc(),
  );
  return {
    issuer,
    investors,
    instrument,
    paymentMint: paymentMint.publicKey,
    bondMint: bondMint.publicKey,
    rpc,
  };
}

export async function fetchState(session: DemoSession): Promise<ChainState> {
  const c = new Connection(session.rpc, "confirmed");
  const p = program(c, session.issuer);
  const instrument = (await (p.account as any).instrument.fetch(
    session.instrument,
  )) as Instrument;
  const actions: ActionRecord[] = await Promise.all(
    Array.from({ length: instrument.nextAction.toNumber() }, async (_, n) => {
      const address = actionAddress(session.instrument, n);
      const [a, vault] = await Promise.all([
        (p.account as any).action.fetch(address),
        getAccount(c, paymentVault(address)),
      ]);
      return { ...a, address, funded: vault.amount } as ActionRecord;
    }),
  );
  const [mint, vault, cash, now] = await Promise.all([
    getMint(c, session.bondMint),
    getAccount(c, bondVault(session.instrument)),
    Promise.all(
      session.investors.map(
        async (k) =>
          (await getAccount(c, cashAccount(session.paymentMint, k.publicKey)))
            .amount,
      ),
    ),
    chainTime(c),
  ]);
  return {
    instrument,
    actions,
    supply: mint.supply,
    custody: vault.amount,
    cash,
    now,
  };
}

export async function schedule(
  session: DemoSession,
  kind: number,
  voteRecordAt = 0,
  voteDuration = 30,
  proposal = "",
) {
  const c = new Connection(session.rpc, "confirmed"),
    p = program(c, session.issuer);
  const i = (await (p.account as any).instrument.fetch(
    session.instrument,
  )) as Instrument;
  const address = actionAddress(session.instrument, i.nextAction);
  const signature = await p.methods
    .scheduleAction(
      i.nextAction,
      kind,
      new BN(voteRecordAt),
      new BN(voteDuration),
      proposal,
    )
    .accountsStrict({
      issuer: session.issuer.publicKey,
      instrument: session.instrument,
      action: address,
      paymentMint: session.paymentMint,
      paymentVault: paymentVault(address),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
  return { address, signature };
}
export async function snapshot(session: DemoSession, address: PublicKey) {
  return program(new Connection(session.rpc, "confirmed"), session.issuer)
    .methods.snapshot()
    .accountsStrict({
      instrument: session.instrument,
      action: address,
      bondMint: session.bondMint,
      bondVault: bondVault(session.instrument),
    })
    .rpc();
}
export async function fund(
  session: DemoSession,
  address: PublicKey,
  amount: bigint,
) {
  return program(new Connection(session.rpc, "confirmed"), session.issuer)
    .methods.fund(new BN(amount.toString()))
    .accountsStrict({
      issuer: session.issuer.publicKey,
      instrument: session.instrument,
      action: address,
      paymentMint: session.paymentMint,
      source: cashAccount(session.paymentMint, session.issuer.publicKey),
      paymentVault: paymentVault(address),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}
export async function reclaimExcess(session: DemoSession, address: PublicKey) {
  return program(new Connection(session.rpc, "confirmed"), session.issuer)
    .methods.reclaimExcess()
    .accountsStrict({
      issuer: session.issuer.publicKey,
      instrument: session.instrument,
      action: address,
      paymentMint: session.paymentMint,
      source: cashAccount(session.paymentMint, session.issuer.publicKey),
      paymentVault: paymentVault(address),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}
export async function settle(
  session: DemoSession,
  address: PublicKey,
  index: number,
  owner: PublicKey,
  executor = session.issuer,
) {
  return program(new Connection(session.rpc, "confirmed"), executor)
    .methods.settle(index)
    .accountsStrict({
      instrument: session.instrument,
      action: address,
      bondMint: session.bondMint,
      paymentMint: session.paymentMint,
      bondVault: bondVault(session.instrument),
      paymentVault: paymentVault(address),
      destination: cashAccount(session.paymentMint, owner),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}
export async function transfer(
  session: DemoSession,
  from: number,
  to: PublicKey,
  quantity: number,
) {
  return program(
    new Connection(session.rpc, "confirmed"),
    session.investors[from],
  )
    .methods.transferPosition(to, new BN(quantity))
    .accountsStrict({
      owner: session.investors[from].publicKey,
      instrument: session.instrument,
    })
    .rpc();
}
export async function vote(
  session: DemoSession,
  address: PublicKey,
  index: number,
  investor: number,
  support: boolean,
) {
  return program(
    new Connection(session.rpc, "confirmed"),
    session.investors[investor],
  )
    .methods.castVote(index, support)
    .accountsStrict({
      owner: session.investors[investor].publicKey,
      action: address,
    })
    .rpc();
}
export async function finalizeVote(session: DemoSession, address: PublicKey) {
  return program(new Connection(session.rpc, "confirmed"), session.issuer)
    .methods.finalizeVote()
    .accountsStrict({ action: address })
    .rpc();
}

export function describeError(error: unknown): string {
  const e = error as {
    error?: { errorMessage?: string };
    message?: string;
    logs?: string[];
  };
  if (e.error?.errorMessage) return e.error.errorMessage;
  const log = e.logs?.find((l) => l.includes("Error Message:"));
  if (log) return log.split("Error Message:")[1].trim();
  return (e.message || String(error)).slice(0, 350);
}
export const shortAddress = (p: PublicKey | string) => {
  const s = p.toString();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};
export const dollars = (n: bigint | BNType | number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(n.toString()) / 1e6);
export const titleFor = (a: Action) =>
  a.kind === COUPON
    ? `Coupon ${a.couponNumber}`
    : a.kind === REDEMPTION
      ? "Principal redemption"
      : "Bondholder vote";
export function explorer(
  value: string,
  rpc: string,
  type: "tx" | "address" = "tx",
) {
  const base = `https://explorer.solana.com/${type}/${value}`;
  return rpc === DEVNET_RPC
    ? `${base}?cluster=devnet`
    : `${base}?cluster=custom&customUrl=${encodeURIComponent(rpc)}`;
}
