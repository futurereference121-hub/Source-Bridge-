# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** Manual-QA remaining priorities (per-user hide, reused support chat, honest dispute receipts)
- **Last verified commit:** `dea2cc423047f5d32eec3907f3ff71d57f2c9335`
- **Last TEST deployment:** `dpl_AQc4HRW9xFMD3tyEVQEZ1h4PnHDg` (`source-bridge-hsmg0h4pt-canna-cake.vercel.app`) → www.sourcebridge.app
- **Known blocker:** Live browser QA on TEST still required — Accept/inspection first-click, hide/support threads, dispute receipts, member cards, mobile ticket menu
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=false`, Stripe TEST (`getStripeMode()` still hard-refuses Live)
- **Last critical regression:** targeted + `test:payments:fast` + `full` PASS; typecheck PASS; build PASS (re-run 2026-08-19)
- **Migration required:** already applied `20260818180000_qa_hide_support_fee` (do not re-apply)

## Baseline (approved, do not “fix” in tooling tasks)

2% fee; sourcing fee base = item + shipping; sourcer fee excluded; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained unless archived via `hiddenFromChatAt`; shared ~45s activity poll (no new 1–2s poll); Live payments off.
