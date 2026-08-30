# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** Clean TEST Payment Tickets out of chats; admin live queues exclude TEST sourcing
- **Last verified commit:** `67ec7e9` on `origin/main` (push/deploy in progress)
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=true` (unchanged); Stripe runtime LIVE on Production; TEST history retained via `hiddenFromChatAt` / ledger
- **Chat cleanup (DB):** 12 unfunded TEST tickets deleted; 11 funded/completed TEST hidden; 3 LIVE sourcing tickets preserved (`cmtcipey60003km0a86vyv54w` + 2); listed-product untouched; LIVE ledger unchanged
- **Last critical regression:** `test:payments:fast` PASS · `test:payments:full` PASS · `test:sourcebridge` PASS · `test:live-guard` PASS · typecheck PASS · build PASS
- **STOP:** Live browser QA of inbox chats recommended to confirm no TEST cards remain and LIVE tickets still visible

## Baseline (approved, do not “fix” in tooling tasks)

7% fee (700 bps); fee base = item + shipping + sourcer/service fee (full seller entitlement); no minimum fee; historical funded deals keep stored fee; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained unless archived via `hiddenFromChatAt`; single active-conversation soft-poll with `activityVersion` / stale-response guard (no competing pollers); Live payments on (`LIVE_PAYMENTS_ENABLED=true`).
