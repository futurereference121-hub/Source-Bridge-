/**
 * Fast critical payment regression (offline, no Stripe network).
 * Run: npm run test:payments:fast
 */
import { runNodeTestScripts } from "./_run-node-tests.mjs";

runNodeTestScripts(
  [
    "scripts/test-live-payments-guard.mjs",
    "scripts/test-live-checkout-mode-guards.mjs",
    "scripts/test-stripe-dual-mode.mjs",
    "scripts/test-pci-no-raw-cards.mjs",
    "scripts/test-ticket-acceptance-and-access.mjs",
    "scripts/test-ticket-state-guard.mjs",
    "scripts/test-chat-ticket-ui.mjs",
    "scripts/test-explore-directory.mjs",
    "scripts/test-product-purchase-ticket.mjs",
    "scripts/test-listed-product-price.mjs",
    "scripts/test-shipping-activity-sync.mjs",
    "scripts/test-payment-release-activity-sync.mjs",
    "scripts/test-photo-upload-control.mjs",
    "scripts/test-payment-journey-regression.mjs",
    "scripts/test-payment-ticket-lifecycle.mjs",
    "scripts/test-payments-domain.mjs",
    "scripts/test-payment-currencies.mjs",
    "scripts/test-direct-payment.mjs",
    "scripts/test-procurement-release.mjs",
    "scripts/test-fulfilment.mjs",
    "scripts/test-listing-payment-options.mjs",
    "scripts/test-allowlist.mjs",
    "scripts/test-ticket-expiry-connect-retry.mjs",
    "scripts/test-checkout-reconcile.mjs",
    "scripts/test-item-issue-wording.mjs",
    "scripts/test-dispute-context-human.mjs",
    "scripts/test-payment-issue-support-context.mjs",
    "scripts/test-admin-case-accordion.mjs",
    "scripts/test-admin-nav-reliability.mjs",
    "scripts/test-protected-fund-zero-transfer.mjs",
    "scripts/test-conversation-pair.mjs",
    "scripts/test-refund-route-readonly.mjs",
    "scripts/test-qa-gaps-15step.mjs",
    "scripts/test-shipping-activity-sync.mjs",
    "scripts/test-payment-release-activity-sync.mjs",
    "scripts/test-dedicated-search.mjs",
    "scripts/test-conversation-delete-cutoff.mjs",
    "scripts/test-sourcer-release-immediacy.mjs",
    "scripts/test-admin-dispute-message-inbox.mjs",
    "scripts/test-ticket-edit-delete-menu.mjs",
    "scripts/test-ticket-edit-draft-isolation.mjs",
    "scripts/test-status-rate-limits.mjs",
  ],
  { label: "payments:fast" },
);

