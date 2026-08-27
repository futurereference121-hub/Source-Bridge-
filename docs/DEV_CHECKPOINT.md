# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** Dual-mode Stripe Connect + Live configuration readiness (architecture only; Live not activated).
- **Last verified commit:** (pending commit of dual-mode; was local-only after prior uncommitted deploy was overwritten by `ec928a9`)
- **Last TEST deployment:** Production was on `ec928a9` (Status soft-poll) without dual-mode; redeploy of dual-mode commit pending — Live OFF
- **Known blocker:** Dual-mode must be on Production before Live activation. LIVE env names may already be present; activation remains a separate dedicated task.
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=false`, Stripe TEST active; architecture supports LIVE when kill switch + keys present
- **Last critical regression:** `test:payments:fast` PASS · `test:stripe-dual-mode` PASS · `test:live-guard` PASS
- **Migration status:** `20260826120000_connect_dual_mode_isolation` APPLIED on Neon (Connect `@@unique([userId, stripeMode])`; TEST IDs preserved)

## Baseline (approved, do not “fix” in tooling tasks)

2% fee; sourcing fee base = item + shipping; sourcer fee excluded; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained unless archived via `hiddenFromChatAt`; single active-conversation soft-poll with `activityVersion` / stale-response guard (no competing pollers); Live payments off.
