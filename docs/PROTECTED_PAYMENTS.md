# Protected Payments — rollout notes

## Charge model
**Separate Charges and Transfers** — platform PaymentIntent, then `Transfer` to the seller Connect account at procurement and/or final release. Instant uses the same model with a prompt transfer after `payment_intent.succeeded` (not a bank payout shortcut).

## Existing listings default
`StockListing.paymentOptions = CONTACT_ONLY` — preserves contact/crypto checkout until the owner explicitly opts into `PROTECTED_ONLY`, `INSTANT_ONLY`, or `BOTH`.

## Feature flags (all default off)
- `PAYMENTS_ENABLED`
- `PROTECTED_PAYMENTS_ENABLED`
- `INSTANT_PAYMENTS_ENABLED`
- `PROCUREMENT_ADVANCES_ENABLED`
- `TRACKING_AUTOMATION_ENABLED`
- `LIVE_PAYMENTS_ENABLED` — **must stay false**; code forces TEST mode even if set.

## Manual configuration still required
1. Enable Stripe Connect on the platform account (Express + transfers capability).
2. Confirm platform country supports Separate Charges and Transfers; if not, **do not** silently switch to Destination Charges — escalate.
3. Set TEST secrets in Vercel: `STRIPE_SECRET_KEY_TEST`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST`, `STRIPE_WEBHOOK_SECRET_TEST`.
4. Register webhook `https://<domain>/api/webhooks/stripe` for `payment_intent.succeeded`, `account.updated`.
5. Run migration `20260803150000_protected_payments_foundation`.
6. Turn flags on only in TEST after Connect onboarding works.
7. Choose production tracking provider; wire API key (mock is default).
8. Legal review of Protected Payment terms / buyer–seller agreements (templates not finalized).
9. Cron: `/api/cron/payments-release` with `CRON_SECRET`.

## Public language
Never use “escrow” in UI. Use Protected Payment / Protected Transaction / Protected by Source Bridge.

## Phase status
See final implementation report in the delivery commit message / agent summary.
