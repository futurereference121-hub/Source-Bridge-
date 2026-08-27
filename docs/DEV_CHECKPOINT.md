# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** Dual-mode Stripe Connect + Live configuration readiness (architecture only; Live not activated).
- **Last verified commit:** `87f6932` (on `origin/main`)
- **Last TEST deployment:** `dpl_CEV5RFr9uxeWuGwWcBkdzAVoME8m` (`source-bridge-otf0t9tb5-canna-cake.vercel.app`) → www.sourcebridge.app — Live OFF
- **Known blocker:** Live activation remains a separate dedicated task (do not flip `LIVE_PAYMENTS_ENABLED`).
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=false`, Stripe TEST active; dual-mode architecture on Production
- **Last critical regression:** `test:payments:fast` PASS · `test:stripe-dual-mode` PASS · `test:live-guard` PASS
- **Migration status:** `20260826120000_connect_dual_mode_isolation` APPLIED on Neon (Connect `@@unique([userId, stripeMode])`; TEST IDs preserved)

## Baseline (approved, do not “fix” in tooling tasks)

2% fee; sourcing fee base = item + shipping; sourcer fee excluded; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained unless archived via `hiddenFromChatAt`; single active-conversation soft-poll with `activityVersion` / stale-response guard (no competing pollers); Live payments off.
