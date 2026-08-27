/**
 * Pre-Live environment guard (no secrets, no Stripe).
 * Fails if source defaults would enable Live payments while kill switch is off.
 * Architecture may return LIVE when LIVE_PAYMENTS_ENABLED is true — that is intentional.
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
assert.match(flags, /LIVE_PAYMENTS_ENABLED/);
assert.match(flags, /envBool\("LIVE_PAYMENTS_ENABLED", false\)/);
// Kill switch off → TEST
assert.match(flags, /if \(!isLivePaymentsEnabled\(\)\) return "TEST"/);
// LIVE only when kill switch explicitly on (architecture ready; not activated by default)
assert.match(flags, /return "LIVE"/);
assert.match(flags, /assertMoneyOpEnvironmentMatch/);

const config = read("src/lib/payments/config.ts");
assert.match(config, /export const SOURCE_BRIDGE_FEE_BPS = 200/);
assert.match(config, /inspectionHours:\s*12/);

const lifecycle = read("src/lib/payments/ticket-lifecycle.ts");
assert.match(lifecycle, /MAX_ACTIVE_PAYMENT_TICKETS = 3/);

const stripeClient = read("src/lib/payments/stripe/client.ts");
assert.match(stripeClient, /STRIPE_SECRET_KEY_TEST/);
assert.match(stripeClient, /STRIPE_SECRET_KEY_LIVE/);
assert.match(stripeClient, /NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE/);
assert.match(stripeClient, /STRIPE_WEBHOOK_SECRET_LIVE/);
assert.match(stripeClient, /STRIPE_CONNECT_WEBHOOK_SECRET_LIVE/);
assert.match(stripeClient, /STRIPE_MODE_MIXED/);
assert.match(stripeClient, /getLivePaymentsReadinessReport/);

const schema = read("prisma/schema.prisma");
assert.match(schema, /@@unique\(\[userId, stripeMode\]\)/);
assert.doesNotMatch(
  schema,
  /model StripeConnectAccount \{[\s\S]*?userId\s+String\s+@unique/,
  "StripeConnectAccount.userId must not remain @unique (blocks TEST+LIVE rows)",
);

const connect = read("src/lib/payments/stripe/connect.ts");
assert.match(connect, /userId_stripeMode/);
assert.match(connect, /LIVE_CONNECT_ONBOARDING_REQUIRED|liveConnectOnboardingRequired/);

console.log(
  "live-payments guard passed (kill switch default false → TEST; dual-mode keys+Connect isolation present; 2% fee, 3-active, 12h inspection)",
);
