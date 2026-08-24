/**
 * Step 7 — Ticket Edit/Delete end-to-end contracts (source + unit, no Stripe money).
 * Run: node scripts/test-ticket-edit-delete-menu.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const card = read("src/components/messaging/PaymentTicketCard.tsx");
const propose = read("src/components/messaging/ProposePaymentTicketButton.tsx");
const tickets = read("src/lib/payments/tickets.ts");
const notify = read("src/lib/payment-notifications.ts");
const deleteRoute = read("src/app/api/payments/tickets/[id]/route.ts");
const createRoute = read("src/app/api/payments/tickets/route.ts");

// --- UI: Edit/Delete menu + prepopulated revise form ---
assert.match(card, /menuPanelRef/);
assert.match(card, /addEventListener\("click", onDoc\)/);
assert.doesNotMatch(card, /addEventListener\("mousedown", onDoc\)/);
assert.match(card, /ticket-actions-menu-collapsed/);
assert.match(card, /setEditOpen\(true\)/);
assert.match(card, /setConfirmDelete\(true\)/);
assert.match(card, /method: "DELETE"/);
assert.match(card, /reviseFromTicketId: ticket\.id/);
assert.match(
  card,
  /editFromTicket=\{\{[\s\S]*reviseFromTicketId: ticket\.id[\s\S]*itemCostMinor: ticket\.itemCostMinor/,
  "edit must open creation form prepopulated from the same ticket",
);
assert.match(
  card,
  /onCreated=\{\(\{ ticket: next \}\) =>/,
  "edit save must apply returned ticket snapshot (same id / revision++)",
);
assert.match(propose, /reviseFromTicketId/);
assert.match(propose, /Revised Terms/);

// --- API: revise uses createOrRevise; delete is DELETE handler ---
assert.match(createRoute, /reviseFromTicketId/);
assert.match(createRoute, /createOrRevisePaymentTicket/);
assert.match(deleteRoute, /export async function DELETE/);
assert.match(deleteRoute, /deletePaymentTicket/);

// --- Server: in-place revise same id, revision++, invalidate acceptance ---
assert.match(
  tickets,
  /In-place revise: same ticket id, bump revision, reset acceptance/,
);
assert.match(tickets, /const updated = await tx\.paymentTicket\.update\(/);
assert.match(tickets, /where: \{ id: open\.id \}/);
assert.match(tickets, /status: "PROPOSED"/);
assert.match(tickets, /revision,/);
assert.match(
  tickets,
  /Cannot revise a funded or in-progress Payment Ticket/,
);
assert.match(tickets, /code: "TICKET_FUNDED"/);

// --- Server: delete unfunded hard-remove; funded blocked ---
assert.match(tickets, /export async function deletePaymentTicket/);
assert.match(tickets, /await tx\.message\.deleteMany/);
assert.match(tickets, /await tx\.paymentTicket\.delete/);
assert.match(tickets, /Only unfunded Payment Tickets can be deleted/);
assert.match(tickets, /assertNotFundedForMutation\(ticket\.status, pt, "delete"\)/);
assert.match(
  tickets,
  /ticket\.status !== "PROPOSED"[\s\S]*ticket\.status !== "DRAFT"[\s\S]*ticket\.status !== "ACCEPTED"/,
);

// --- Actions: ACCEPTED unfunded may edit + delete ---
assert.match(
  tickets,
  /if \(opts\.status === "ACCEPTED"\) \{\s*return \{ canEdit: true, canCancel: true, canDelete: true \}/,
);

// --- Renegotiation notify (not silently deduped on same ticket id) ---
assert.match(notify, /isRevision/);
assert.match(notify, /revised Payment Ticket terms/);
assert.match(notify, /Prior acceptance was cleared/);
assert.match(notify, /pt-proposed:\$\{opts\.ticketId\}:v\$\{revision\}/);
assert.match(tickets, /isRevision: Boolean\(open\)/);
assert.match(tickets, /revision: ticket\.revision/);

console.log("[test-ticket-edit-delete-menu] passed");
