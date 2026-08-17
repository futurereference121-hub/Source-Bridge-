# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** Manual-QA correction pass (P1–P8)
- **Last verified commit:** `b995039` (pending deploy verify)
- **Last TEST deployment:** pending `vercel deploy --prod`
- **Known blocker:** Manual E2E on TEST — propose ticket (no error page), inbox loader, dispute banner after resolve, protected listing ship photo UI
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=false`, Stripe TEST
- **Last critical regression:** `test:payments:fast` + `full` PASS; typecheck PASS; build PASS
- **Migration required:** none new (uses existing `proposalTraceId`, `Notification.dedupeKey`, `DisputeCase.category`)

## Baseline (approved, do not “fix” in tooling tasks)

2% fee; sourcing fee base = item + shipping; sourcer fee excluded; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained unless archived via `hiddenFromChatAt`; shared ~45s activity poll (no new 1–2s poll); Live payments off.
