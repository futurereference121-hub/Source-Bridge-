# Payment disputes & terms (TEST)

## Dispute flow (current TEST behaviour)

1. Buyer confirms item received, then starts the 12-hour inspection window.
2. During inspection only, buyer may **Report a Problem** with a category
   (Item not as agreed, Wrong item, Damaged in transit, etc.).
3. Source Bridge creates a `DisputeCase`, moves the protected transaction to
   `DISPUTED`, and freezes scheduled auto-release of residual seller funds.
4. Admin reviews cases at `/admin/reviews` (OPEN → UNDER_REVIEW → resolved).
5. Resolution uses existing financial controls (release residual, refund buyer,
   partial split) — no retroactive changes to already-released item funds.

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
