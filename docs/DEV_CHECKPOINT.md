# Development checkpoint

Update only when finishing a meaningful workstream. Keep this short.

## Current

- **Workstream:** Chat performance + Payment Ticket create-form responsive layout + accept-scroll + ticket header stability
- **Last verified commit:** this commit (chat/UI stability; payment engines unchanged)
- **Last TEST deployment:** pending this push to Production TEST
- **Known blocker:** Real-device QA of create-form on Android + HP Windows + iPhone; Accept viewport on mobile.
- **Payment environment:** `LIVE_PAYMENTS_ENABLED=false`, Stripe TEST
- **Last critical regression:** `npm run test:payments:fast` and `test:payments:full` PASS; typecheck PASS; `next build` PASS
- **Next recommended step:** After TEST production serves this SHA, visual QA of Payment Ticket create on Android / Windows laptop / iPhone. Do not pay. Dirty conversation `cms8p1pxr000cla04dm4zfp6d` read-only.

## Baseline (approved, do not “fix” in tooling tasks)

2% fee; sourcing fee base = item + shipping; sourcer fee excluded; 3 active tickets; distinct Proposer/Buyer/Sourcer; counterparty Accept; buyer-only fund; Connect destination = sourcer; buyer-authorized procurement; 12-hour inspection; issue freeze; idempotent final residual; Direct Destination Charge; Protected delayed release; unfunded dead tickets hidden from chat; funded history retained; ~2.5s soft-poll; Live payments off.
