/**
 * Redaction and gate checks for the checkout preflight. No network.
 * Run: node --experimental-strip-types scripts/test-gp-checkout-preflight.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accountLoginFacts,
  emailPlaceholderKind,
  isUsableCheckoutBuyer,
  readCashAvailable,
} from "../src/lib/payments/payout-rail/preview-checkout-preflight-report.ts";

let passed = 0;
function ok(name: string, cond: unknown) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

ok("invalid domain is a placeholder", emailPlaceholderKind("person@example.invalid") === "reserved_invalid_domain");
ok("example.com is a placeholder", emailPlaceholderKind("person@example.com") === "reserved_example");
ok("ordinary domain is not a placeholder", emailPlaceholderKind("person@sourcebridge.app") === null);

const facts = accountLoginFacts({
  id: "user_secret_id",
  email: "gp-testingtesting@example.invalid",
  emailVerified: false,
  passwordHash: null,
  onboardingComplete: true,
  mustChangePassword: false,
  isDemo: false,
  isTestAccount: true,
  deletedAt: null,
});
const encoded = JSON.stringify(facts);
ok("account facts omit the email", !encoded.includes("example.invalid") && !encoded.includes("gp-testing"));
ok("account facts omit the password hash", !("passwordHash" in facts) && !encoded.includes("passwordHash"));
ok("placeholder kind is reserved invalid", facts.email_placeholder === "reserved_invalid_domain");
ok("passwordless account cannot use password login", facts.password_login_supported === false);
ok(
  "verified password buyer is usable",
  isUsableCheckoutBuyer(
    accountLoginFacts({
      id: "buyer_other",
      email: "buyer@sourcebridge.app",
      emailVerified: true,
      passwordHash: "hash",
      onboardingComplete: false,
      mustChangePassword: false,
      isDemo: false,
      isTestAccount: false,
      deletedAt: null,
    }),
    facts.user_h8,
  ) === true,
);
ok("demo account is not a usable buyer", isUsableCheckoutBuyer({ ...facts, email_verified: true, has_password: true, is_demo: true }, "other") === false);
ok("cash available stays an integer minor", readCashAvailable({ balance: { cash: { available: { value: 4150, currency: "gbp" } } } }).available_minor === 4150);

const route = source("../src/app/api/diagnostics/gp-preview-runtime/checkout-preflight/route.ts");
const runner = source("../src/lib/payments/payout-rail/preview-checkout-preflight.ts");
const e2e = source("../src/app/api/diagnostics/gp-preview-runtime/e2e/route.ts");
const restore = source("../src/app/api/diagnostics/gp-preview-runtime/restore/route.ts");
ok("preflight route is GET only", route.includes("export async function GET") && !route.includes("export async function POST"));
ok("runner refuses a different database", runner.includes("database_host_mismatch"));
ok("runner does not post to Stripe", !runner.includes('method: "POST"'));
ok("mutation routes stay disabled", e2e.includes("status: 410") && restore.includes("status: 410"));

console.log(`\n${passed} passed`);
