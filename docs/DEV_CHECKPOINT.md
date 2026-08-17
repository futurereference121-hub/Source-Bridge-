# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** Manual-QA remaining gaps (P6 ship photo, inactivity release, P7 private admin threads)
- **Last verified commit:** `fdf5ba6`
- **Last TEST deployment:** `dpl_BRysRDKUJX1D89m4GkHZTcyMRZdu` → www.sourcebridge.app
- **Known blocker:** Manual E2E on TEST — listing ship photo, admin private threads, human-currency resolve, inactivity release
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=false`, Stripe TEST
- **Last critical regression:** `test:payments:fast` + `full` PASS; typecheck PASS; build PASS
- **Migration required:** applied `20260817190000_admin_dispute_private_threads`

## Baseline (approved, do not “fix” in tooling tasks)

2% fee; sourcing fee base = item + shipping; sourcer fee excluded; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained unless archived via `hiddenFromChatAt`; shared ~45s activity poll (no new 1–2s poll); Live payments off.
