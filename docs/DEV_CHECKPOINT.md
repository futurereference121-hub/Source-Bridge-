# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** Cursor development framework (rules, regression commands, indexing, hooks)
- **Last verified commit:** product isolation `86f73b0`; this file lands with the Cursor framework commit
- **Last TEST deployment:** product SHA `86f73b0` (Accept/cancel isolation) — live browser QA still outstanding
- **Known blocker:** Payment Ticket live browser QA on dirty conversation `cms8p1pxr000cla04dm4zfp6d` (Accept CTA + cancelled tickets hidden) — product task, not this tooling task
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=false`, Stripe TEST
- **Last critical regression:** `npm run test:payments:fast` and `test:payments:full` PASS (tooling commit)
- **Next recommended step:** After Vercel has `86f73b0` (or later product SHA), live TEST QA of Accept/cancel isolation — do not pay

## Baseline (approved, do not “fix” in tooling tasks)

2% fee; sourcing fee base = item + shipping; sourcer fee excluded; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained; ~2.5s soft-poll; Live payments off.
