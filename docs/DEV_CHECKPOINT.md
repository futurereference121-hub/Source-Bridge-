# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** QA ticket reset + Pay CTA after fund + shipped → Confirm Item Received → Release/Inspect
- **Last verified commit:** `1a9f892` (checkpoint `04114ed`)
- **Last TEST deployment:** Production TEST — https://www.sourcebridge.app (`source-bridge-d37iyg1ep` / `dpl_4tPn3JLib9sucEtS67hM8NXVaMp8`)
- **Known blocker:** User must run live TEST browser QA (create one new ticket, fund, ship, confirm receipt, release). Do not seed tickets for the three QA accounts.
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=false`, Stripe TEST
- **Last critical regression:** `npm run test:payments:fast` and `test:payments:full` PASS; typecheck PASS; `next build` PASS
- **QA reset:** futureman / theowlsaid / bellahap chats have 0 visible tickets and 0 counting toward the 3-active cap. Funded PT/PI/Charge rows kept, `hiddenFromChatAt` set. Unfunded proposed ticket expired. No refunds/new charges.
- **Lifecycle fixes:** Authoritative `ticketMayShowPayUi` (funded/PI succeeded/processing never show Pay). Ship → Confirm Item Received → Release Funds Now | Start 12-Hour Inspection. Residual release requires receipt. Generic archive via `hiddenFromChatAt`.

## Baseline (approved, do not “fix” in tooling tasks)

2% fee; sourcing fee base = item + shipping; sourcer fee excluded; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained unless archived via `hiddenFromChatAt`; ~2.5s soft-poll; Live payments off.
