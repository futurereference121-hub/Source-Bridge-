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

## Connect Accounts v2 + webhooks

Source Bridge creates sellers with **Accounts v2** (`POST /v2/core/accounts`, API version `2026-07-29.dahlia`) and dashboard=`express`, merchant `card_payments` + recipient `stripe_transfers`.

v2 connected accounts emit:

| Format | Scope in Workbench | Example types |
|--------|--------------------|---------------|
| **Thin events** (`object: v2.core.event`) | **Your account** | `v2.core.account[requirements].updated`, `v2.core.account[configuration.merchant].capability_status_updated`, … |
| **Snapshot events** | **Connected accounts** | `account.updated` |

Do **not** assume Connect status arrives only via `account.updated`. Prefer thin v2 types on **Your account**. After any Connect webhook we re-fetch the account (v1 retrieve is compatible with v2 Account ids) and update local non-financial status (`chargesEnabled`, `payoutsEnabled`, `requirementsJson`).

### Routes
| URL | Role |
|-----|------|
| `https://www.sourcebridge.app/api/webhooks/stripe` | Platform payment events |
| `https://www.sourcebridge.app/api/webhooks/stripe/connect` | Connect account status (thin + optional snapshot) |

Webhook signature verification, idempotent `processedWebhookEvent` storage, and Connect **status sync** run **even when `PAYMENTS_ENABLED` is false**. Funding confirmation and all money movement stay gated on payment flags. Live-mode events are acknowledged but never acted on while LIVE is disabled.

### Environment variables (Vercel Production — TEST only)
| Name | Purpose |
|------|---------|
| `STRIPE_SECRET_KEY_TEST` | API (TEST) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST` | Client publishable key when payments UI is enabled later |
| `STRIPE_WEBHOOK_SECRET_TEST` | Signing secret for platform destination (fallback: `STRIPE_WEBHOOK_SECRET`) |
| `STRIPE_CONNECT_WEBHOOK_SECRET_TEST` | Signing secret for Connect destination (fallback: `STRIPE_CONNECT_WEBHOOK_SECRET`) |

Never commit or log webhook secrets.

## Manual configuration still required

### 1. Platform webhook destination (payments)
1. Stripe Dashboard → **Workbench → Webhooks** (TEST / Sandbox mode).
2. **Add destination** → **Webhook endpoint**.
3. **Events from:** **Your account**.
4. **Events:** `payment_intent.succeeded`.
5. **URL:** `https://www.sourcebridge.app/api/webhooks/stripe`
6. Copy the signing secret → Vercel env `STRIPE_WEBHOOK_SECRET_TEST`.

### 2. Connect webhook destination (Accounts v2 thin — required)
1. **Add destination** → **Webhook endpoint**.
2. **Events from:** **Your account** (required for v2 Account thin events on *your* connected accounts).
3. **Events (thin / v2):**
   - `v2.core.account.created`
   - `v2.core.account.updated`
   - `v2.core.account.closed`
   - `v2.core.account[configuration.merchant].updated`
   - `v2.core.account[configuration.merchant].capability_status_updated`
   - `v2.core.account[configuration.recipient].updated`
   - `v2.core.account[configuration.recipient].capability_status_updated`
   - `v2.core.account[requirements].updated`
   - `v2.core.account[future_requirements].updated`
   - `v2.core.account[identity].updated`
   - `v2.core.account[defaults].updated`
   - `v2.core.account_link.returned`
4. **URL:** `https://www.sourcebridge.app/api/webhooks/stripe/connect`
5. Copy the signing secret → Vercel env `STRIPE_CONNECT_WEBHOOK_SECRET_TEST`.

### 3. Optional companion: classic Connect snapshot
Only if you want redundant `account.updated` delivery (not required when thin events are configured):
1. **Events from:** **Connected accounts**.
2. **Events:** `account.updated`.
3. **URL:** same `…/api/webhooks/stripe/connect` (this route multi-tries Connect secrets first).
4. Use a second secret only if the Connect destination above already filled `STRIPE_CONNECT_WEBHOOK_SECRET_TEST` — put the companion secret in `STRIPE_CONNECT_WEBHOOK_SECRET`, or consolidate into one Connect destination if Workbench allows.

### Lifecycle mapping (for ops, not separate event names)
| Seller state | Primary thin signal(s) |
|--------------|------------------------|
| Begins onboarding | `v2.core.account.created` |
| Submits / returns from Account Link | `v2.core.account_link.returned` + identity/requirements updates |
| Requirements due / restricted | `v2.core.account[requirements].updated` (`disabled_reason` / currently_due after re-fetch) |
| Payouts / transfers eligibility | `v2.core.account[configuration.recipient].capability_status_updated` |
| Charges / card_payments eligibility | `v2.core.account[configuration.merchant].capability_status_updated` |
| Payouts disabled / capability loss | recipient capability + requirements updates (local `payoutsEnabled` after re-fetch) |

### Remaining rollout
1. Enable Stripe Connect on the platform account (Express-style Accounts v2 + transfers capability).
2. Confirm platform country supports Separate Charges and Transfers; if not, **do not** silently switch to Destination Charges — escalate.
3. Set TEST secrets in Vercel (table above).
4. Register **two** webhook destinations as above (platform + Connect thin).
5. Run migration `20260803150000_protected_payments_foundation`.
6. Turn flags on only in TEST after Connect onboarding + webhook delivery works.
7. Choose production tracking provider; wire API key (mock is default).
8. Legal review of Protected Payment terms / buyer–seller agreements (templates not finalized).
9. Cron: `/api/cron/payments-release` with `CRON_SECRET`.

## Public language
Never use “escrow” in UI. Use Protected Payment / Protected Transaction / Protected by Source Bridge.

## Phase status
Webhook foundation accepts Stripe delivery while payment flags stay off. Checkout and funding remain gated until ops enables TEST flags deliberately.
