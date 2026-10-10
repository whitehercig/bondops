# BondOps

**Corporate actions, accounted for.**

BondOps is a working Solana prototype for servicing tokenized bonds: record holders, calculate entitlements, execute settlement, retire principal tokens and preserve a verifiable outcome. Built for the KASE × Superteam Kazakhstan corporate actions challenge.

## Run locally

Requirements: Node.js 20.20+, Rust, Solana/Agave CLI with `cargo-build-sbf` and `solana-test-validator`, Anchor CLI 0.31.1. Dependency versions are locked in `package-lock.json` and `Cargo.lock`.

```bash
npm ci
npm run program:build
```

Keep these commands running in two terminals:

```bash
# Terminal 1 — isolated BondOps validator; resets only .local/ledger
npm run localnet

# Terminal 2 — frontend
npm run dev
```

Open **http://127.0.0.1:5179** and choose **Launch on-chain demo**. RPC: `http://127.0.0.1:18999`. The custom ports avoid interfering with another local Solana validator.

The frontend creates a real SPL Token bond mint, an isolated DemoUSD mint, three investor positions (10 / 6 / 4 bonds), and an immutable timetable. Two coupons and maturity redemption are queued in advance. A reporting vote provides the additional corporate action.

Demo keys are generated for this browser session and stored in sessionStorage so a reload can resume. These are sandbox roles, not a production wallet integration. Never fund them with real assets. **New demo** clears the browser's session and creates another instrument; it does not erase chain records.

## Verify the program

With the validator running:

```bash
npm run test:chain
npm run build
npm run demo
```

`test:chain` sends actual transactions to the Solana validator, including negative cases. It writes sanitized evidence to `.local/test-evidence.json`. `demo` runs the full lifecycle and saves shareable public addresses and transaction signatures in `docs/evidence/demo.json`.

The frontend is a direct RPC client. It does not use a backend to calculate entitlements or pretend payments happened.

## What is implemented

| Requirement | Implementation |
| --- | --- |
| Test financial instrument | SPL bond mint, immutable economic terms, PDA-controlled pooled custody |
| Holder registry | On-chain wallet positions; issuer-only issuance; irreversible issuance seal |
| Record date | Solana Clock, advance action queue, enforced position freeze at earliest pending record date |
| Entitlements | Program calculates checked integer micro-unit amounts from immutable snapshots |
| Coupon | Dedicated funded action vault; permissionless beneficiary-constrained payment |
| Redemption | Principal transfer and corresponding SPL Token burn in the same transaction |
| Additional action | Snapshot-weighted voting; 50% quorum and strict majority; on-chain final result |
| Outcome record | Persistent action accounts, beneficiary paid/voted flags, amounts, timestamps, burn counts, events |
| Recovery | Fresh executor reads paid flags and resumes unpaid entries |
| Product UX | Overview, action workspace, holder registry, investor rights, audit export, Explorer links |

## What is simulated or limited

- DemoUSD represents payment units; it is not USD, USDC or an actual fiat rail.
- The demo uses generated investor wallets and names. KYC, beneficial-owner identification and KASE connections are simulated.
- The UI uses accelerated time: two coupon periods of 60 seconds. Financial coupon frequency remains semiannual; this is a demonstration timetable, not real elapsed-year interest accrual.
- Economic terms support a fixed periodic coupon. Calendar business-day adjustments, irregular coupons, tax withholding, day-count conventions and FX conversion are not implemented.
- Program custody is intentional. Investors own registry positions backed by pooled tokens; they do not freely trade this mint through an external DEX.
- Maximum 32 lifetime registered wallets per instrument and 32 simultaneously pending actions. Zero-balance holders remain in the registry. The entire snapshot is atomic at this scale. A larger production registry requires paginated snapshots or balance checkpoints.
- Blockchain transactions require an executor. Solana does not wake itself at a future timestamp; `scripts/demo.ts` demonstrates the off-chain executor.
- This prototype is verified on localnet. A devnet deployment requires faucet funds for a dedicated test operator; check `docs/VERIFICATION.md` for the current deployment status.
- The legacy Anchor/SPL JavaScript dependency tree reports known npm advisories. The app restricts demo networks to localnet/devnet and is not ready to custody production assets.

## Devnet

```bash
# The deployment script creates .local/devnet-operator.json if absent.
# Request test SOL for this dedicated wallet; no personal wallet is used.
solana airdrop 2 --url devnet --keypair .local/devnet-operator.json
npm run deploy:devnet
```

If the wallet does not yet exist, run `solana-keygen new --no-bip39-passphrase --outfile .local/devnet-operator.json` first. Deployment uses only the explicit dedicated wallet and never changes your global Solana config. A deploy needs enough test SOL for program rent. Once confirmed, choose **Devnet** in the frontend. Fresh browser demo accounts also need a successful devnet faucet request.

Do not commit `.local/`, `target/deploy/*keypair.json` or browser signing keys. A new clone generates a new program keypair and updates Rust, Anchor configuration and the IDL via `npm run program:build`.

## Submission materials

- [Technical overview](docs/TECHNICAL_OVERVIEW.md)
- [Demo video script](docs/DEMO_SCRIPT.md)
- [Submission description](docs/SUBMISSION.md)
- [Verification evidence and remaining work](docs/VERIFICATION.md)

Source structure: `programs/bondops/src/lib.rs` (program), `app/src/client.ts` (RPC client), `app/src/App.tsx` (product), `tests/chain.ts` (integration checks), `scripts/demo.ts` (executor).

MIT license. No affiliation with or endorsement by KASE is claimed.
