# Payment regression manifest

Critical Source Bridge payment flows, invariants, and which command covers them. Product detail: `docs/PROTECTED_PAYMENTS.md`. Freeze: `.cursor/rules/00-payment-production-freeze.mdc`.

**PRODUCTION-FROZEN.** Live payments **enabled** (`LIVE_PAYMENTS_ENABLED=true`). New development may continue. Automated suites must not create PaymentIntent / Charge / Transfer / Refund unless the task explicitly requires financial verification.

## Commands

| Tier | Command | When |
|---|---|---|
| Fast | `npm run test:payments:fast` | Every payment-sensitive iteration |
| Full | `npm run test:payments:full` | Before declaring payment work complete |
| Guard | `npm run test:live-guard` | Included in fast; run if env/flags touched |
| Release-local | `npm run test:sourcebridge` | Full + typecheck (no deploy, no `next build`) |
| Build | `npm run build` | Before TEST deploy |
| DB timeline | `npm run test:payment-ticket-timeline` | **Explicit only** — can use DATABASE_URL |

## Invariants (must not change accidentally)

- Fee **7% / 700 bps**. Product base = listing price (+ shipping/service if present). Sourcing base = item + shipping + sourcer/service fee (full seller entitlement; fee does not compound). Historical deals keep stored fee.
- `procurementTransferredMinor + finalTransferredMinor <= sellerEntitledMinor`
- Max **3 active** Payment Tickets per conversation
- Proposer / Buyer / Sourcer distinct; counterparty Accept; only `buyerId` funds
- Seller Connect destination = `sellerId`’s own account
- Buyer-authorized procurement only; 12-hour inspection; issue freezes release; final release idempotent
- Direct = Destination Charge (`transfer_data.destination` + `application_fee_amount`)
- Protected = platform hold + delayed transfer
- Unfunded CANCELLED/DECLINED/SUPERSEDED/**EXPIRED** hidden from normal chat; funded history retained
- Authenticated ticket/conversation: no shared viewer cache
- TEST Connect onboarding is available to any eligible account (seller's own connected account only)
- Failed PaymentIntent remains retryable (`requires_payment_method`); funding is webhook-authoritative
- Unfunded tickets with no meaningful activity for **72 hours** expire and leave the 3-active count

## Fast suite covers

Fee math, roles, proposal/counterparty, acceptance, buyer-only fund *authorization*, 3-active, ticket isolation, cancel terminal, completed derivation, seller residual, Direct architecture, protected release invariants, PCI scan, Live-flag source guard, allowlist/TEST ramp, 72h unfunded expiry, Connect funding gate vs Accept.

## Full suite adds

Webhook signature/unit paths, Connect onboarding safety (no network).

## Requires live TEST browser QA

Any user-facing change to: Accept/Decline, Pay CTA, ticket collapse, cancel hiding, polling, receipt/inspection buttons, checkout Payment Element.

Not Production Ready TEST from unit tests alone.

## Generic users

A/B/C permutations in `scripts/test-payment-journey-regression.mjs` and `scripts/test-ticket-acceptance-and-access.mjs`. Do not add core tests that require `futureman` / `theowlsaid`.

## Account independence

CORE MARKETPLACE FUNCTIONALITY MUST BE ACCOUNT-INDEPENDENT. Accept uses conversation-session `User.id` (`viewerUserId` on conversation GET), not a cached `/api/auth/me` account from another party. No feature is complete if it only works for historical test accounts. Critical flows use generic A/B/C/D fixtures.
