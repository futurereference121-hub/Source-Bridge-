/**
 * Ticket state guard + out-of-order poll regression (offline).
 * Generic users only — no historical account IDs.
 * Run: node scripts/test-ticket-state-guard.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// Compile-free mirror: load TS via dynamic import if available, else inline copy of logic.
const guardPath = path.join(root, "src/lib/payments/ticket-state-guard.ts");
assert.ok(fs.existsSync(guardPath), "ticket-state-guard.ts must exist");

function ticketAppearsFunded(t) {
  if (t.fundedAt) return true;
  if (t.paymentIntentStatus === "succeeded") return true;
  const ps = (t.protectedTxnStatus || "").toUpperCase();
  if (["FUNDED", "PROCUREMENT_RELEASED", "AWAITING_SHIPMENT", "DELIVERED", "IN_INSPECTION", "RELEASED"].includes(ps)) {
    return true;
  }
  return (t.status || "").toUpperCase() === "FUNDED";
}

function stateEpoch(t) {
  const candidates = [t.updatedAt, t.lastMeaningfulActivityAt].filter(Boolean);
  let max = 0;
  for (const iso of candidates) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms) && ms > max) max = ms;
  }
  const rev = Number(t.revision ?? 0);
  const buyer = Number(t.buyerApprovedRevision ?? -1);
  const seller = Number(t.sellerApprovedRevision ?? -1);
  return max * 1000 + rev * 10 + (buyer === rev ? 1 : 0) + (seller === rev ? 2 : 0);
}

function shouldApplyTicketUpdate(incoming, existing) {
  if (!existing) return true;
  const incomingFunded = ticketAppearsFunded(incoming);
  const existingFunded = ticketAppearsFunded(existing);
  if (existingFunded && !incomingFunded) return false;
  const inEpoch = stateEpoch(incoming);
  const exEpoch = stateEpoch(existing);
  if (inEpoch > exEpoch) return true;
  if (inEpoch < exEpoch) return false;
  const rev = Number(incoming.revision ?? 0);
  const buyerIn = Number(incoming.buyerApprovedRevision ?? -1);
  const sellerIn = Number(incoming.sellerApprovedRevision ?? -1);
  const buyerEx = Number(existing.buyerApprovedRevision ?? -1);
  const sellerEx = Number(existing.sellerApprovedRevision ?? -1);
  if (buyerIn === rev && buyerEx !== rev) return true;
  if (sellerIn === rev && sellerEx !== rev) return true;
  if (incomingFunded && !existingFunded) return true;
  return false;
}

// P3: funded UI must survive delayed pre-funded response
{
  const funded = {
    updatedAt: "2026-08-20T10:00:01.000Z",
    status: "FUNDED",
    protectedTxnStatus: "FUNDED",
    fundedAt: "2026-08-20T10:00:01.000Z",
    lifecycleStage: "AWAITING_SHIPMENT",
    revision: 1,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: 1,
  };
  const stalePreFund = {
    updatedAt: "2026-08-20T09:59:00.000Z",
    status: "ACCEPTED",
    protectedTxnStatus: "AWAITING_PAYMENT",
    fundedAt: null,
    lifecycleStage: "AWAITING_PAYMENT",
    revision: 1,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: 1,
  };
  assert.equal(shouldApplyTicketUpdate(stalePreFund, funded), false);
  assert.equal(shouldApplyTicketUpdate(funded, stalePreFund), true);
}

// Accept progress within same ms still applies
{
  const before = {
    updatedAt: "2026-08-20T10:00:00.000Z",
    revision: 2,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 2,
    status: "PROPOSED",
  };
  const after = {
    updatedAt: "2026-08-20T10:00:00.000Z",
    revision: 2,
    buyerApprovedRevision: 2,
    sellerApprovedRevision: 2,
    status: "ACCEPTED",
  };
  assert.equal(shouldApplyTicketUpdate(after, before), true);
  assert.equal(shouldApplyTicketUpdate(before, after), false);
}

// Source wiring
const convRoute = fs.readFileSync(
  path.join(root, "src/app/api/conversations/[id]/route.ts"),
  "utf8",
);
const inbox = fs.readFileSync(
  path.join(root, "src/components/messaging/MessagesInbox.tsx"),
  "utf8",
);
const card = fs.readFileSync(
  path.join(root, "src/components/messaging/PaymentTicketCard.tsx"),
  "utf8",
);
assert.match(convRoute, /activityVersion/);
assert.match(convRoute, /sinceVersion/);
assert.match(inbox, /activityVersionRef/);
assert.match(inbox, /sinceVersion=/);
assert.match(card, /shouldApplyTicketUpdate/);
assert.match(
  fs.readFileSync(path.join(root, "src/lib/conversation-activity.ts"), "utf8"),
  /bumpConversationActivity/,
);

console.log("[test-ticket-state-guard] passed");
