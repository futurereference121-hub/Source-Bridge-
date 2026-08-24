# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** Final 12-step QA — Steps 7–8 checkpoint (ticket edit/delete end-to-end; listed product purchases in Purchases / Sales & Fulfilment, not Inbox). Steps 9–12 not started. Deploy deferred.
- **Last verified commit:** (this checkpoint; see `git log -1`)
- **Last TEST deployment:** `dpl_E4Aj5vkJpwXZVeXMyztY7fAvFwHW` (`source-bridge-5bowg9g3s-canna-cake.vercel.app`) → www.sourcebridge.app — **not redeployed for Steps 7–8**
- **Known blocker:** Live browser QA still required for Steps 5–8. Steps 9–12 pending.
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=false`, Stripe TEST (`getStripeMode()` still hard-refuses Live)
- **Last critical regression:** Steps 7–8 targeted source tests PASS; typecheck PASS; full suite / deploy / live QA not claimed here
- **Migration status:** `20260821193000_message_hide_shipment_photo` APPLIED on Production TEST Neon (MessageHide + ProtectedTransaction.shipmentPhotoUrl). Prior `20260820140000_activity_version_platform_fee_refund` already APPLIED. `20260823160000_conversation_delete_cutoff` (`deletedBeforeAt`) required for Step 6 — confirm APPLIED on Production TEST before relying on delete-cutoff resurface in live QA.

## Baseline (approved, do not “fix” in tooling tasks)

2% fee; sourcing fee base = item + shipping; sourcer fee excluded; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained unless archived via `hiddenFromChatAt`; single active-conversation soft-poll with `activityVersion` / stale-response guard (no competing pollers); Live payments off.
