# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** Manual-QA architectural performance pass (activityVersion + stale ticket guard + admin fee UI)
- **Last verified commit:** `262e191108364688bd739f1db810c39141b57832`
- **Last TEST deployment:** `dpl_6mzsDxkhp5uCL1vd1sA1dgiU6r1b` (`source-bridge-pacqly4o9-canna-cake.vercel.app`) → www.sourcebridge.app
- **Known blocker:** Live browser QA on TEST still required — Accept/payment sync, inspection, shipping photos, profile tab timings. Migration `20260820140000_activity_version_platform_fee_refund` must be applied on Production DB if not auto-migrated.
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=false`, Stripe TEST (`getStripeMode()` still hard-refuses Live)
- **Last critical regression:** targeted + `test:payments:fast` + `full` PASS; typecheck PASS; build PASS (2026-08-20)
- **Migration required:** apply `20260820140000_activity_version_platform_fee_refund` (`activityVersion`, `platformFeeRefundedMinor`)

## Baseline (approved, do not “fix” in tooling tasks)

2% fee; sourcing fee base = item + shipping; sourcer fee excluded; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained unless archived via `hiddenFromChatAt`; single active-conversation soft-poll with `activityVersion` / stale-response guard (no competing pollers); Live payments off.
