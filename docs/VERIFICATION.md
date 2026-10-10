# Verification — 10 October 2026

**Story:** an issuer creates a tokenized bond in the browser, queues its corporate actions, fixes holder rights through Solana instructions, pays coupons, redeems principal and inspects persistent on-chain evidence.

## Verified deployment

The compiled SBF program is running on an isolated local Solana validator at `http://127.0.0.1:18999`.

Program: `GtFrFiH2UxfLbiwAaEtVcfnNZ2zuygSmeqtRzfZ8tpQG`.

Frontend: `http://127.0.0.1:5179`.

**Devnet is not deployed.** The dedicated test operator's faucet requests for 5 SOL and 2 SOL were rejected with `airdrop request failed`. No personal wallet or real SOL was used. The dedicated devnet operator address is `ApDndrNegeL2mEBPhty6mnvARNvrhCjzcoeQmTMoDbTw`. Deployment commands are provided in the README.

## Flow evidence

| Boundary | Result | Evidence |
| --- | --- | --- |
| SBF program compilation | Passed | `cargo build-sbf --tools-version v1.57`; compiled program executes successfully in the validator |
| IDL generation | Passed | `anchor idl build`; tracked `app/src/idl.json` contains instruction/account layout |
| TypeScript and production bundle | Passed | `npm run build` |
| Browser → Solana RPC | Passed | Browser created the bond mint, payment mint, custody, positions and four action accounts |
| Record date → entitlement state | Passed | Complete immutable snapshots stored in action accounts; queue ordering enforced |
| Program → SPL Token payments | Passed | Both browser coupons transferred real test-token units to investor accounts |
| Restart → remaining payments | Passed | Browser paid Aida, reloaded, then resumed Timur/Dana without paying Aida twice |
| Principal → burn → UI | Passed | Browser redemption paid 20,000 DemoUSD, retired 20 tokens and displayed zero registry/custody/supply |
| On-chain state → audit export | Passed | JSON displayed in the evidence dialog, saved from that visible field and reconciled; `evidence/browser-audit.json` |
| Automatic file download | Not independently observed | In-app browser did not expose a download event; evidence dialog provides inspectable/copyable JSON and a download link |
| Weighted voting | Passed in real transaction suite and CLI demo | Owner signatures, original weights, duplicate rejection, quorum and majority checked |
| Browser voting finalization | Passed | Browser's deliberately late snapshot had zero turnout; finalization correctly recorded failure to reach quorum |

The browser instrument was `GarKk5Fr7vnZnx7cVeq37Cmpx84RESHAo2cu1VtGcD4M`. Its exported result is:

```text
Total obligations: 22,000.00 DemoUSD
Total payments:    22,000.00 DemoUSD
Remaining:             0.00 DemoUSD
Registry quantity:        0
Custody quantity:         0
Mint supply:              0
Retired bonds:           20
```

## 39 meaningful on-chain checks

The suite sends actual instructions to the compiled program, rather than mirroring a JavaScript implementation. The machine-readable check names and successful transaction signatures are in `evidence/checks.json`.

Coverage includes sealed issuance; custody authority; holder authorization; invalid quantities; future action queue; snapshot ordering and immutability; record-date and maturity locks; coupon formulas; post-record transfers; underfunding; wrong beneficiaries; repeated payments and votes; independent-executor resume; reserved-cash withdrawal rejection; completed-action surplus return; quorum and majority; rollback before payment/burn; principal redemption; supply reconciliation; and no action after redemption.

The test fixture ends with 0 bonds and investor balances of 8,700 / 8,900 / 4,400 DemoUSD. The separate CLI demo fixture ends with 0 bonds and 6,800 / 10,800 / 4,400 DemoUSD; it transfers four bonds only after the first coupon record. Different fixtures intentionally demonstrate different record-date histories.

`evidence/demo.json` contains the CLI lifecycle evidence. These are localnet addresses and signatures; they require the matching running validator. Resetting `.local/ledger` removes the local history. They must not be described as devnet evidence.

## Remaining submission work

1. Fund and deploy the dedicated test operator on devnet; rerun the lifecycle and replace local-only evidence if a remotely accessible demo is desired.
2. Record the demo video using `DEMO_SCRIPT.md` and add its actual URL.
3. Publish a source repository accessible to judges and add its URL to `SUBMISSION.md`.
4. Complete the team's main Colosseum registration and check regional eligibility.

Prototype limitations and dependency advisories are disclosed in the README. This verification does not constitute an independent security audit.
