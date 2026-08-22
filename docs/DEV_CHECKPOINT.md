# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** Close remaining 15-step QA gaps (chat hide/delete, admin protected refund/release without dispute, shipping photo reveal/hide)
- **Last verified commit:** `289e66680edc6f0bf184251c8e897afb6c1799ec`
- **Last TEST deployment:** `dpl_E4Aj5vkJpwXZVeXMyztY7fAvFwHW` (`source-bridge-5bowg9g3s-canna-cake.vercel.app`) → www.sourcebridge.app
- **Known blocker:** Live browser QA still required for Hide/Delete chat, admin no-dispute money controls, and shipping photo reveal/hide.
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=false`, Stripe TEST (`getStripeMode()` still hard-refuses Live)
- **Last critical regression:** targeted + `test:payments:fast` + `full` PASS; typecheck PASS; build PASS; `test:live-guard` PASS
- **Migration status:** `20260821193000_message_hide_shipment_photo` APPLIED on Production TEST Neon (MessageHide + ProtectedTransaction.shipmentPhotoUrl). Prior `20260820140000_activity_version_platform_fee_refund` already APPLIED.

## Baseline (approved, do not “fix” in tooling tasks)

2% fee; sourcing fee base = item + shipping; sourcer fee excluded; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained unless archived via `hiddenFromChatAt`; single active-conversation soft-poll with `activityVersion` / stale-response guard (no competing pollers); Live payments off.
