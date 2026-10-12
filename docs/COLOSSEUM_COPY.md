# Colosseum submission copy

## Project name

BondOps

## One-line description

Solana corporate actions for tokenized bonds: record-date snapshots, coupon settlement, atomic redemption and holder voting.

## Short description

BondOps automates the lifecycle promises attached to a tokenized bond. It records eligible holders at a contractual cutoff, calculates coupon and principal entitlements on Solana, settles DemoUSD payments, retires bonds at maturity and leaves an auditable on-chain record.

The prototype demonstrates every KASE side-track scenario: coupon payment, bond redemption and snapshot-weighted bondholder voting. A controlled holder registry prevents a late operator from changing eligibility after the record date. Each action stores the recorded balances, entitlement amounts and payment status. At redemption, principal transfer and token burn occur in the same Solana transaction for each holder.

## What is implemented

- Anchor program and SPL Token bond instrument on Solana localnet
- Holder registry and enforced record-date transfer freeze
- Coupon entitlement calculation using checked integer arithmetic
- Fully funded per-action settlement vaults and durable paid flags
- Principal payment and matching bond burn in one transaction
- Snapshot-weighted bondholder voting with a 50% quorum
- React interface, audit reconciliation and JSON evidence export

## What is simulated

DemoUSD represents the payment asset. Investor identity, KYC, KASE connectivity and fiat settlement are outside this prototype. The demo compresses a two-period calendar into minutes. See `TECHNICAL_OVERVIEW.md` for architecture and the exact implemented/simulated boundary.

## Links

- Source: https://github.com/whitehercig/bondops
- Demo video: add the final hosted video URL
- Live UI: https://bondops.groovy-rhea-0976.chatgpt.site

