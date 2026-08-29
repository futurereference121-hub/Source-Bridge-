# Source Bridge — agent instructions

This file is the short always-on map. Detailed rules live in `.cursor/rules/`. Workflow: `docs/AGENT_WORKFLOW.md`. Payments: `docs/PAYMENT_REGRESSION.md`. Resume state: `docs/DEV_CHECKPOINT.md`.

## Product

User-to-user sourcing marketplace. Public language: **Protected Payment** / **Direct Payment** — never “escrow”.

Financial roles are distinct: **Proposer** (current revision), **Buyer** (`buyerId`, pays), **Sourcer** (`sellerId`, seller entitlement / Connect destination). Do not infer one from another. Marketplace flows must work for any eligible accounts (generic-user fixtures), not only historical test accounts. Do not hardcode `futureman` / `theowlsaid` except explicit QA fixtures.

## Live payments (activated)

Production kill switch is **`LIVE_PAYMENTS_ENABLED=true`** (Stripe runtime LIVE). Do not flip it off except as an emergency kill switch after a verified Live money invariant failure. TEST history stays operable via mode-scoped clients. No PaymentIntent / Charge / Transfer / Refund unless the task explicitly requires Live financial verification. LIVE Connect ≠ TEST Connect — never reuse TEST `acct_*` for Live money.

## Speed vs safety

Faster work comes from persistent rules, reusable `npm run test:payments:fast` / `test:payments:full`, and parallel **read-only** investigation. Do not skip tests, live QA, or diff review. One implementation owner for payment logic.

## Two-tier verification

1. **Fast** (`npm run test:payments:fast`) during iteration.
2. **Release / payment** (`npm run test:payments:full`, typecheck, build, TEST deploy, live browser QA) before calling payment-sensitive work complete.

User-facing payment work is not **Production Ready TEST** until live TEST browser QA. If login is impossible: **IMPLEMENTED — LIVE QA REQUIRED**.

## Completion statuses

Report separately: Implementation / Unit tests / Regression / Deployment / Live browser QA / Production Ready TEST.
