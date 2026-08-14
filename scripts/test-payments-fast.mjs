/**
 * Fast critical payment regression (offline, no Stripe network).
 * Run: npm run test:payments:fast
 */
import { runNodeTestScripts } from "./_run-node-tests.mjs";

runNodeTestScripts(
  [
    "scripts/test-live-payments-guard.mjs",
    "scripts/test-pci-no-raw-cards.mjs",
    "scripts/test-ticket-acceptance-and-access.mjs",
    "scripts/test-payment-journey-regression.mjs",
    "scripts/test-payment-ticket-lifecycle.mjs",
    "scripts/test-payments-domain.mjs",
    "scripts/test-direct-payment.mjs",
    "scripts/test-procurement-release.mjs",
    "scripts/test-fulfilment.mjs",
    "scripts/test-listing-payment-options.mjs",
    "scripts/test-allowlist.mjs",
  ],
  { label: "payments:fast" },
);
