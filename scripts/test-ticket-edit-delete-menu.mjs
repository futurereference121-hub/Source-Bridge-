/**
 * Ticket Edit/Delete menu must survive portal outside-click (click, not mousedown).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const card = fs.readFileSync(
  path.join(root, "src/components/messaging/PaymentTicketCard.tsx"),
  "utf8",
);

assert.match(card, /menuPanelRef/);
assert.match(card, /addEventListener\("click", onDoc\)/);
assert.doesNotMatch(card, /addEventListener\("mousedown", onDoc\)/);
assert.match(card, /ticket-actions-menu-collapsed/);
assert.match(card, /setEditOpen\(true\)/);
assert.match(card, /setConfirmDelete\(true\)/);
assert.match(card, /method: "DELETE"/);
assert.match(card, /reviseFromTicketId/);

console.log("[test-ticket-edit-delete-menu] passed");
