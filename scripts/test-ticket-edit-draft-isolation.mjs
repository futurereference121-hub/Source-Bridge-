/**
 * Payment Ticket EDIT draft isolation (source + money util contracts).
 * Covers the snap-back bug: soft-poll / parent re-renders must not reset
 * local edit draft while typing.
 *
 * Run: node scripts/test-ticket-edit-draft-isolation.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const propose = read("src/components/messaging/ProposePaymentTicketButton.tsx");
const card = read("src/components/messaging/PaymentTicketCard.tsx");
const tickets = read("src/lib/payments/tickets.ts");
const money = read("src/lib/payments/money.ts");

// --- 1 Open: prefill from saved ticket ---
assert.match(card, /setEditOpen\(true\)/);
assert.match(
  card,
  /editFromTicket=\{\{[\s\S]*reviseFromTicketId: ticket\.id[\s\S]*itemCostMinor: ticket\.itemCostMinor/,
);
assert.match(card, /revision: ticket\.revision/);
assert.match(propose, /applyEditPrefillToDraft/);

// --- 2–5 / 10 Draft isolation: init once per ticket id; no [editFromTicket] wipe ---
assert.match(propose, /draftInitializedForTicketIdRef/);
assert.match(
  propose,
  /draftInitializedForTicketIdRef\.current === ticketId/,
  "must skip re-applying saved amounts when already initialized for this ticket",
);
assert.doesNotMatch(
  propose,
  /useEffect\(\(\) => \{\s*if \(!editFromTicket\) return;\s*setItemMajor\(minorToMajor\(editFromTicket\.itemCostMinor/,
  "must not re-set itemMajor from editFromTicket on every object identity change",
);
assert.match(
  propose,
  /Parent soft-poll \/ ticketSnapshot re-renders/,
  "documents why draft must not follow live ticket props while editing",
);

// Inputs bind to local draft strings (not ticket.amount / ticket.itemCostMinor)
assert.match(propose, /value=\{itemMajor\}/);
assert.match(propose, /value=\{shippingMajor\}/);
assert.match(propose, /value=\{serviceMajor\}/);
assert.match(propose, /onChange=\{\(e\) => setItemMajor\(e\.target\.value\)\}/);
assert.match(propose, /onChange=\{\(e\) => setShippingMajor\(e\.target\.value\)\}/);
assert.match(propose, /onChange=\{\(e\) => setServiceMajor\(e\.target\.value\)\}/);
assert.doesNotMatch(propose, /value=\{ticket\.(amount|itemCostMinor)/);
assert.doesNotMatch(card, /key=\{ticket\.(updatedAt|activityVersion)/);

// Intermediate typing + blur/save parse via centralized money util
assert.match(propose, /parseHumanAmountToMinor/);
assert.match(propose, /parseDraftMajorToMinor/);
assert.match(propose, /formatDraftMajorOnBlur/);
assert.match(propose, /onBlur=\{\(\) =>\s*setItemMajor/);
assert.match(money, /export function parseHumanAmountToMinor/);
assert.match(money, /currencyExponent/);

// --- 6 Cancel discards draft ---
assert.match(propose, /function closeForm\(\)/);
assert.match(
  propose,
  /draftInitializedForTicketIdRef\.current = null[\s\S]*setOpen\(false\)[\s\S]*onCloseEdit/,
);
assert.match(propose, /data-testid="ticket-propose-cancel"/);

// --- 7 Save same PaymentTicket.id, revision++ ---
assert.match(propose, /reviseFromTicketId: editFromTicket\.reviseFromTicketId/);
assert.match(
  tickets,
  /In-place revise: same ticket id, bump revision, reset acceptance/,
);
assert.match(tickets, /where: \{ id: open\.id \}/);

// --- 8 Accepted-unfunded renegotiation ---
assert.match(
  tickets,
  /if \(opts\.status === "ACCEPTED"\) \{\s*return \{ canEdit: true, canCancel: true, canDelete: true \}/,
);
assert.match(tickets, /status: "PROPOSED"/);
assert.match(tickets, /isRevision: Boolean\(open\)/);

// --- 9 Funded blocked ---
assert.match(tickets, /Cannot revise a funded or in-progress Payment Ticket/);
assert.match(tickets, /code: "TICKET_FUNDED"/);

// --- 10 Remote conflict notice (do not silently overwrite) ---
assert.match(propose, /revisionConflict/);
assert.match(propose, /data-testid="ticket-edit-revision-conflict"/);
assert.match(propose, /Your draft was not overwritten/);

// --- 11 Mobile viewport classes (360/390) ---
assert.match(propose, /min-w-0/);
assert.match(propose, /w-full/);
assert.match(propose, /max-w-full|max-w-md/);
assert.match(propose, /100dvh|85dvh|safe-area-inset/);
assert.doesNotMatch(propose, /userAgent|navigator\.userAgent/);

// Runtime: money util decimals (not assume *100)
const runner = `
import assert from "node:assert/strict";
import {
  parseHumanAmountToMinor,
  majorToMinor,
  minorToMajor,
} from "../src/lib/payments/money.ts";

assert.equal(parseHumanAmountToMinor("12.50", "EUR"), 1250);
assert.equal(parseHumanAmountToMinor("12.", "EUR"), null, "trailing dot is intermediate — reject until complete");
assert.equal(parseHumanAmountToMinor("", "EUR"), null);
assert.equal(parseHumanAmountToMinor("100", "JPY"), 100);
assert.equal(majorToMinor(12.5, "EUR"), 1250);
assert.equal(majorToMinor(100, "JPY"), 100);
assert.equal(minorToMajor(1250, "EUR"), 12.5);
assert.equal(parseHumanAmountToMinor("1.234", "BHD"), 1234);
console.log("[money-draft-parse] ok");
`;

const tmp = path.join(root, ".cursor", "_tmp-ticket-edit-draft-money.mts");
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, runner);
try {
  const r = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", tmp],
    { cwd: root, encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    console.error(r.stdout || "");
    console.error(r.stderr || "");
    process.exit(r.status || 1);
  }
  if (r.stdout?.trim()) console.log(r.stdout.trim());
} finally {
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
}

console.log("[test-ticket-edit-draft-isolation] passed");
