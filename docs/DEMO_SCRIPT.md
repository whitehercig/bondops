# Demo video script

Target length: 3–4 minutes. Record the actual interface with the local validator running. Use English narration for the submission; this script also provides Russian preparation notes.

## 0:00 — the problem

“Tokenization creates an instrument. Servicing keeps the promises attached to it. BondOps tracks who has the right to a coupon, executes payment, conducts a holder vote and retires principal tokens — with verifiable Solana records.”

Open the overview. Show the sandbox disclosure before launching.

## 0:15 — create the instrument

Click **Launch on-chain demo**. The app creates 20 bonds with a $1,000 face value, 10% annual coupon and semiannual frequency. Aida holds 10, Timur 6 and Dana 4.

“For the demo, the calendar is accelerated to two 60-second periods. DemoUSD is a test payment token. Core corporate-action logic runs in the Solana program.”

Show the reporting vote, both coupons and redemption queued in advance. The operator does not need to recreate the timetable after each action.

## 0:30 — voting and fixed rights

Select the reporting vote and **Record snapshot** after its record time. Open **Holder registry**. Cast Aida's vote for and Timur's vote against. Transfer four bonds from Aida to Timur before the first coupon cutoff.

“Aida now owns six bonds, but her voting weight remains ten. The snapshot fixes rights at the record date. A buyer cannot reuse the seller's voting rights.”

Return to the vote and finalize after its close timestamp. With Aida for and Timur against, 16/20 bonds participated and 10/16 voted for: quorum met, proposal passed.

## 1:00 — coupon and interruption recovery

Select coupon 1. Record its snapshot. Expected quantities are 6 / 10 / 4 and amounts $300 / $500 / $200.

Show the formula: `quantity × $1,000 × 10% / 2`.

Click **Fund obligation**, then **Pay one holder**. Reload the browser and return to the action. Click **Resume all**.

“The executor resumed from persistent on-chain flags. Already-paid investors are skipped.”

Click **Test duplicate** on a paid entry. Show the program rejection and unchanged balances. The UI may report the completed-action state error if every entry has already been paid; the integration suite additionally checks the specific duplicate-entry error while the action is partially settled.

## 1:40 — final coupon and redemption

At the second coupon cutoff, transfers are locked at maturity. Record coupon 2, fund and settle. Select redemption. Its snapshot is enabled only after the final coupon snapshot.

Fund principal and settle holders. Expected principal is $6,000 / $10,000 / $4,000 if the only transfer was Aida's four bonds to Timur.

“Each principal payment and the matching bond burn share one transaction. A payment failure cannot destroy the investor's bonds.”

## 2:30 — verify the outcome

Open **Audit trail**. Show zero outstanding positions, zero custody and zero mint supply. Show accrued obligations equal paid plus remaining. Open an action account or transaction in Explorer using the custom localnet RPC link. Export the evidence JSON.

“The outcome is stored in Solana accounts. The browser's activity list is a convenience; the action state is independently verifiable.”

## Closing

“Implemented today: issuance, controlled holder registry, record dates, coupon payments, atomic principal redemption and snapshot voting. Simulated today: DemoUSD, investor identity and external KASE/fiat connections. BondOps provides a servicing engine that a registrar or payment agent can integrate with its operating workflow.”

## Russian recording notes

- Не выдавай localnet за devnet. Если программа развёрнута в devnet позже, перезапиши доказательства и обнови документацию.
- Запиши все три сценария и открой хотя бы одну транзакцию/запись действия.
- Не показывай содержимое sessionStorage, `.local/` ключей или `target/deploy/*keypair.json`.
- Купоны уже запланированы: опоздание исполнителя сохраняет правильные позиции, но блокирует переводы до снимка.
- Если голосование закрылось до первого голоса, запусти **New demo** и заново пройди сценарий.
