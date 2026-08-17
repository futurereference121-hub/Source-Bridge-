# Payment disputes & terms (TEST)

## Dispute flow (current TEST behaviour)

1. Buyer confirms item received, then starts the 12-hour inspection window.
2. During inspection only, buyer may **Report a Problem** with a category
   (Item not as agreed, Wrong item, Damaged in transit, etc.).
3. Source Bridge creates a `DisputeCase`, moves the protected transaction to
   `DISPUTED`, and freezes scheduled auto-release of residual seller funds.
4. Admin reviews cases at `/admin/reviews` (OPEN → UNDER_REVIEW → resolved).
   Parties see **UNDER REVIEW BY SOURCE BRIDGE**. Admin Message Buyer and
   Message Sourcer are **private** Admin↔party threads linked to the dispute
   (`disputeCaseId` / `paymentTicketId`) — they do not share the Buyer↔Sourcer
   conversation. Both threads are visible on `/admin/reviews/[disputeId]`.
5. Resolution uses existing financial controls (release residual, refund buyer,
   partial split) with **human currency fields** (e.g. GBP £50.00, not raw
   `10000` minor units), confirmation, and server-side bounds. Resolved
   DisputeCase status removes frozen banners. COMPLETED tickets never show
   FUNDS FROZEN.

## Protected listing inactivity release (TEST)

One constant: `BUYER_INACTIVITY_ADMIN_RELEASE_MS` in
`src/lib/payments/fulfilment-rules.ts`.

**TEST value: 72 hours** after seller `shippedAt` if the buyer has not
confirmed receipt. An **admin** may then authorize residual release from
`/admin/payments`. This is not automatic seller release and is not hooked
into the inspection cron.

## Notifications

Payment lifecycle events (propose, accept, fund, ship, dispute open/resolve)
create in-app notifications with `dedupeKey` to avoid duplicates on retries.
Polling reuses the existing 45s shared notification loop — no new aggressive
poll endpoints.

## Terms & Conditions (future legal requirement)

Before Live activation, buyers reporting a dispute should confirm acceptance of
platform dispute terms (wording TBD with legal counsel). This is **not**
implemented in TEST yet; UI currently collects category + optional details only.

Do not enable Live payments or change fee/cap/inspection rules as part of
dispute/terms work unless explicitly tasked.
