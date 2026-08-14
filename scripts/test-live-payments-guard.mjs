/**
 * Pre-Live environment guard (no secrets, no Stripe).
 * Fails if source defaults would enable Live payments or leave TEST mode.
 * Run: node scripts/test-live-payments-guard.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const flags = read("src/lib/payments/flags.ts");
assert.match(flags, /LIVE_PAYMENTS_ENABLED must remain false/);
assert.match(flags, /envBool\("LIVE_PAYMENTS_ENABLED", false\)/);
assert.match(flags, /return "TEST"/);
assert.doesNotMatch(
  flags,
  /getStripeMode[\s\S]{0,400}return "LIVE"/,
  "getStripeMode must not return LIVE while pre-Live refuse is in place",
);
assert.match(flags, /LIVE_PAYMENTS_ENABLED:\s*false/);

const config = read("src/lib/payments/config.ts");
assert.match(config, /export const SOURCE_BRIDGE_FEE_BPS = 200/);
assert.match(config, /inspectionHours:\s*12/);

const lifecycle = read("src/lib/payments/ticket-lifecycle.ts");
assert.match(lifecycle, /MAX_ACTIVE_PAYMENT_TICKETS = 3/);

const stripeClient = read("src/lib/payments/stripe/client.ts");
assert.match(
  stripeClient,
  /Only Stripe TEST secret keys are accepted while LIVE_PAYMENTS_ENABLED=false/,
);

console.log("live-payments guard passed (source defaults: LIVE=false, Stripe TEST, 2% fee, 3-active, 12h inspection)");
