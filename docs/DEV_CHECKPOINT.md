# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** 7% platform fee rounds to nearest minor unit (no Math.ceil).
- **Last verified commit:** `1ec75ed` on `origin/main`
- **Production deployment:** `dpl_ENCqLp1xTi79cH5YwpepRqFYrT7s` (`source-bridge-e02qpfa3g-canna-cake.vercel.app`) → www.sourcebridge.app — Live ON
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=true` (unchanged); Stripe runtime LIVE on Production; TEST history remains operable via mode-scoped clients
- **Last critical regression:** `test:payments:fast` PASS · `test:payments:full` PASS · `test:sourcebridge` PASS · `test:live-guard` PASS · typecheck PASS · build PASS
- **Migration:** `20260829140000_source_bridge_fee_7pct` APPLIED on Neon — `PlatformPaymentConfig` now 700/700 bps, floor 0; ticket/txn stored fees untouched
- **STOP:** User creates next LIVE transaction manually to verify corrected 7% rounding ($0.75 → $0.05) — no automated LIVE charges created

## Baseline (approved, do not “fix” in tooling tasks)

7% fee (700 bps); fee base = item + shipping + sourcer/service fee (full seller entitlement); no minimum fee; historical funded deals keep stored fee; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained unless archived via `hiddenFromChatAt`; single active-conversation soft-poll with `activityVersion` / stale-response guard (no competing pollers); Live payments on (`LIVE_PAYMENTS_ENABLED=true`).
