# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** Manual-QA architectural performance pass (activityVersion + stale ticket guard + admin fee UI)
- **Last verified commit:** (pending deploy — see FINAL REPORT)
- **Last TEST deployment:** pending after this commit
- **Known blocker:** Live browser QA on TEST still required — Accept/payment sync, inspection, shipping photos, profile tab timings
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=false`, Stripe TEST (`getStripeMode()` still hard-refuses Live)
- **Last critical regression:** targeted + `test:payments:fast` + `full` PASS; typecheck PASS; build PASS (2026-08-20)
- **Migration required:** apply `20260820140000_activity_version_platform_fee_refund` (`activityVersion`, `platformFeeRefundedMinor`)

## Baseline (approved, do not “fix” in tooling tasks)

2% fee; sourcing fee base = item + shipping; sourcer fee excluded; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained unless archived via `hiddenFromChatAt`; single active-conversation soft-poll with `activityVersion` / stale-response guard (no competing pollers); Live payments off.
