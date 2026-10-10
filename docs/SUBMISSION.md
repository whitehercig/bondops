# BondOps

**Corporate actions, accounted for.**

BondOps is a Solana servicing engine for tokenized bonds. Issuers and payment agents can identify holders at a contractual record date, calculate coupon or principal entitlements, execute settlement and verify outcomes from persistent on-chain records.

Our prototype demonstrates all three required scenarios: coupon payment, maturity redemption and bondholder voting. It uses a controlled on-chain holder registry backed by a real SPL Token bond mint in program custody. Future actions are queued in advance. Transfers are blocked by the Solana clock at the earliest pending record date, so a late executor cannot change historical entitlement ownership.

The program calculates payment amounts using checked integer arithmetic. Independent action vaults must be fully funded before settlement begins. A durable paid flag prevents duplicate execution, and another executor can resume an interrupted batch. At maturity, each holder's principal payment and corresponding bond-token burn occur atomically in one transaction. Voting uses immutable snapshot weights, a 50% participation quorum and a strict majority of votes cast.

The interface provides an instrument overview, corporate-action workspace, holder registry, investor rights and an audit trail with reconciliation, Explorer links and JSON export. We demonstrate the post-record transfer edge case, interrupted execution, duplicate rejection and payment-before-burn safety in real local Solana transactions.

**Implemented:** Solana program, test instrument, holder registry, record-date enforcement, entitlement calculations, SPL Token payments, principal redemption, weighted voting and on-chain outcome accounts.

**Simulated:** DemoUSD payment asset, investor identity/KYC and KASE/fiat integrations. Time is accelerated for the demo. The current registry is intentionally bounded to 32 wallets, with atomic snapshots and program custody. Verified deployment status and evidence are in `docs/VERIFICATION.md`.

Repository URL: **add the source repository URL before submitting**.

Demo video URL: **record using `docs/DEMO_SCRIPT.md` and add the video URL**.

Main Colosseum registration: **complete and verify team registration before submitting this side track**.
