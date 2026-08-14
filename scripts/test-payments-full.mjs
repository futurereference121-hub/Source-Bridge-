/**
 * Full payment regression (offline unit/integration mirrors, no Stripe money ops).
 * Does not run DB-mutating scripts even if DATABASE_URL is set.
 * Optional DB: npm run test:payment-ticket-timeline (explicit).
 * Run: npm run test:payments:full
 */
import { runNodeTestScripts } from "./_run-node-tests.mjs";

runNodeTestScripts(
  [
    "scripts/test-payments-fast.mjs",
    "scripts/test-stripe-webhooks.mjs",
    "scripts/test-connect-onboarding.mjs",
  ],
  { label: "payments:full" },
);
