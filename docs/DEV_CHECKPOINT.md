# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** Close remaining 15-step QA gaps (chat hide/delete, admin protected refund/release without dispute, shipping photo reveal/hide)
- **Last verified commit:** (pending deploy SHA — see git log / Vercel)
- **Last TEST deployment:** pending after this ship
- **Known blocker:** Live browser QA still required for Hide/Delete chat, admin no-dispute money controls, and shipping photo reveal/hide. Migration `20260821193000_message_hide_shipment_photo` must be applied on Production TEST Neon before MessageHide / shipmentPhotoUrl work at runtime.
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=false`, Stripe TEST (`getStripeMode()` still hard-refuses Live)
- **Last critical regression:** targeted + `test:payments:fast` + `full` PASS; typecheck PASS; build PASS; `test:live-guard` PASS
- **Migration status:** `20260821193000_message_hide_shipment_photo` (MessageHide + ProtectedTransaction.shipmentPhotoUrl) — apply with `npm run db:migrate` on Production TEST Neon. Prior `20260820140000_activity_version_platform_fee_refund` already APPLIED.

## Baseline (approved, do not “fix” in tooling tasks)

2% fee; sourcing fee base = item + shipping; sourcer fee excluded; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained unless archived via `hiddenFromChatAt`; single active-conversation soft-poll with `activityVersion` / stale-response guard (no competing pollers); Live payments off.
