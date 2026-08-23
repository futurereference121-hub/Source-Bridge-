/**
 * Steps 6–7 — admin in-place accordion + human support context (IDs in Advanced).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const reviews = read("src/app/admin/reviews/page.tsx");
const purchases = read("src/app/admin/payments/listed-purchases-section.tsx");
const purchasesRedirect = read("src/app/admin/purchases/page.tsx");
const accordion = read("src/app/admin/reviews/admin-case-accordion.tsx");
const evidence = read("src/app/admin/reviews/admin-evidence-gallery.tsx");
const msgLink = read("src/app/admin/reviews/admin-dispute-message-link.tsx");
const notify = read("src/lib/payment-notifications.ts");

assert.match(reviews, /AdminCaseAccordion/);
assert.match(reviews, /AdminEvidenceGallery/);
assert.match(reviews, /Advanced \/ Audit/);
assert.doesNotMatch(reviews, /Open case/);
assert.doesNotMatch(
  reviews,
  /href=\{`\/admin\/reviews\/\$\{issue\.id\}`\}/,
  "reviews list must not navigate to slow per-case page as primary",
);
assert.match(purchases, /AdminCaseAccordion/);
assert.match(purchasesRedirect, /\/admin\/payments#listed-product-purchases/);
assert.doesNotMatch(
  purchases,
  /href=\{`\/admin\/purchases\/\$\{t\.id\}`\}/,
  "purchases list must expand in place, not navigate away",
);
assert.match(accordion, /__SB_ADMIN_CASE_EXPAND_MS__/);
assert.match(accordion, /defaultOpen = false/);
assert.match(evidence, /View Photo/);
assert.match(evidence, /admin-evidence-lightbox/);
assert.match(msgLink, /AdminDisputeMessenger/);
assert.doesNotMatch(msgLink, /router\.push/);
assert.match(notify, /The Buyer reported an issue with the item/);

console.log("test-admin-case-accordion: PASS");
