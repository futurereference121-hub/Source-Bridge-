/**
 * Display copy for Global Payouts states that cannot be opened while
 * initiation is disabled. No database, no Stripe, no Production session.
 *
 * Run: node scripts/test-gp-unavailable-ui-states.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (process.env.SB_GP_UI_STATE_TEST !== "1") {
  const env = { ...process.env, SB_GP_UI_STATE_TEST: "1", NODE_ENV: "test" };
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      pathToFileURL(path.join(here, "gp-sandbox-ticket-loader.mjs")).href,
      fileURLToPath(import.meta.url),
    ],
    { cwd: root, env, stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const assert = (await import("node:assert/strict")).default;
const { derivePurchaseDisplayState } = await import(
  "../src/lib/payments/purchase-display-state.ts"
);
const {
  formatInspectionWindow,
  sellerReleaseProgressCopy,
  shippedAwaitingReceiptCopy,
  CONNECT_RELEASED_SELLER_COPY,
} = await import("../src/lib/payments/fulfilment-display.ts");
const { deriveOutboundDisplayState, GP_POSTED_WORDING } = await import(
  "../src/lib/payments/payout-rail/outbound-display.ts"
);
const { deriveGpPayoutUi } = await import("../src/lib/payments/payout-rail/gpPayoutUi.ts");
const { GP_GBP_FLAT_FEE_EXPLANATION } = await import("../src/lib/payments/gp-pricing.ts");

const base = {
  status: "DELIVERED",
  shippedAt: "2026-10-01T00:00:00.000Z",
  deliveredAt: "2026-10-02T00:00:00.000Z",
  openDispute: false,
};

assert.equal(
  derivePurchaseDisplayState({ ...base, status: "DISPUTED" }).label,
  "Under review by Source Bridge",
);
assert.equal(
  derivePurchaseDisplayState({ ...base, status: "IN_INSPECTION", openDispute: true }).label,
  "Under review by Source Bridge",
);
assert.equal(
  derivePurchaseDisplayState({ ...base, status: "CANCELLED" }).label,
  "Cancelled",
);
assert.equal(
  derivePurchaseDisplayState({ ...base, status: "IN_INSPECTION", openDispute: false }).label,
  "Inspection active",
);
assert.equal(
  derivePurchaseDisplayState({ ...base, status: "READY_TO_RELEASE" }).label,
  "Completed — payout in progress",
);
assert.equal(
  derivePurchaseDisplayState({
    status: "AWAITING_SHIPMENT",
    shippedAt: "2026-10-01T00:00:00.000Z",
    trackingNumber: "1Z999",
  }).label,
  "Shipped — awaiting receipt confirmation",
);
assert.equal(
  derivePurchaseDisplayState({ ...base, status: "DELIVERED" }).label,
  "Item received — choose release or inspection",
);
assert.match(shippedAwaitingReceiptCopy("seller"), /awaiting receipt confirmation/);
assert.doesNotMatch(shippedAwaitingReceiptCopy("seller"), /release now or start inspection/);
assert.equal(
  sellerReleaseProgressCopy({ status: "RELEASED", payoutRail: "STRIPE_CONNECT" }),
  CONNECT_RELEASED_SELLER_COPY,
);
assert.match(
  sellerReleaseProgressCopy({
    status: "RELEASED",
    payoutRail: "STRIPE_GLOBAL_PAYOUTS",
    gpHeadline: "Release confirmed. Source Bridge is funding your sourcer’s international payout. No further action is needed.",
  }) || "",
  /is funding/,
);
assert.equal(
  sellerReleaseProgressCopy({
    status: "RELEASED",
    payoutRail: "STRIPE_GLOBAL_PAYOUTS",
  }),
  "Completed — international payout has been sent.",
);
assert.match(
  sellerReleaseProgressCopy({
    status: "READY_TO_RELEASE",
    payoutRail: "STRIPE_GLOBAL_PAYOUTS",
    gpHeadline: "Final release authorized — payout pending. The item advance already sent is separate.",
  }) || "",
  /payout pending/,
);
{
  const windowCopy = formatInspectionWindow("2026-10-25T16:00:00.000Z", Date.parse("2026-10-25T12:00:00.000Z"));
  assert.equal(windowCopy?.expired, false);
  assert.match(windowCopy?.remainingLabel || "", /4 hours/);
  assert.match(windowCopy?.summary || "", /Inspection ends/);
  assert.doesNotMatch(windowCopy?.summary || "", /3–6|3-6 day|within three days of release/);
}
{
  const ended = formatInspectionWindow("2026-10-25T11:00:00.000Z", Date.parse("2026-10-25T12:00:00.000Z"));
  assert.equal(ended?.expired, true);
  assert.match(ended?.summary || "", /refresh from the server/);
}

const returned = deriveOutboundDisplayState("RETURNED");
assert.equal(returned.buyerLabel, "Payout returned — Source Bridge is reviewing");
assert.equal(returned.phase, "returned");
const failed = deriveOutboundDisplayState("FAILED");
assert.equal(failed.buyerLabel, "Release not completed — funds remain protected");
const funding = deriveOutboundDisplayState("AWAITING_FA_FUNDS");
assert.equal(
  funding.buyerLabel,
  "Release confirmed. Checking payout status. No further action is needed.",
);
assert.equal(funding.needsAdminAction, false);
assert.doesNotMatch(funding.buyerLabel, /within three days|is funding/);
const fundingPending = deriveOutboundDisplayState("AWAITING_FA_FUNDS", "GP_FA_BALANCE_SHORT", {
  proceedsFundingEnabled: true,
  chargeAvailable: false,
  fundingStatus: "AWAITING_SETTLEMENT",
});
assert.match(fundingPending.buyerLabel, /once your payment is available/);
const fundingReview = deriveOutboundDisplayState("AWAITING_FA_FUNDS", "GP_INITIATION_DISABLED", {
  proceedsFundingEnabled: false,
  failureCode: "GP_INITIATION_DISABLED",
});
assert.match(fundingReview.buyerLabel, /reviewing the payout/);
assert.equal(fundingReview.needsAdminAction, true);
const fundingProgress = deriveOutboundDisplayState("AWAITING_FA_FUNDS", "GP_FA_BALANCE_SHORT", {
  proceedsFundingEnabled: true,
  chargeAvailable: true,
  fundingStatus: "SHORT",
});
assert.match(fundingProgress.buyerLabel, /waiting to fund/);
assert.doesNotMatch(fundingProgress.buyerLabel, /is funding|being processed|reviewing/);
assert.doesNotMatch(fundingProgress.buyerLabel, /within three days/);
const fundingPosted = deriveOutboundDisplayState("AWAITING_FA_FUNDS", null, {
  proceedsFundingEnabled: true,
  fundingStatus: "POSTED",
});
assert.match(fundingPosted.buyerLabel, /funding is confirmed/);
const fundingActive = deriveOutboundDisplayState("AWAITING_FA_FUNDS", null, {
  proceedsFundingEnabled: true,
  fundingStatus: "FUNDING",
});
assert.match(fundingActive.buyerLabel, /is funding/);
assert.doesNotMatch(fundingActive.buyerLabel, /waiting to fund/);
const review = deriveOutboundDisplayState("PROCESSING", "GP_UNDER_REVIEW");
assert.equal(review.sellerLabel, "Payout under review");
assert.equal(review.pendingProvider, true);
assert.match(GP_POSTED_WORDING, /does not confirm the recipient bank has paid/);

const notStarted = deriveGpPayoutUi({
  enabled: true,
  configured: true,
  hasRecipient: false,
  status: "",
  payoutReady: false,
  payoutMethodReady: false,
  requirementsDueCount: 0,
  disabledReason: "",
});
assert.equal(notStarted.state, "not_started");
assert.equal(notStarted.showSetUpPayouts, true);
assert.equal(notStarted.showRefreshStatus, false);

const attention = deriveGpPayoutUi({
  enabled: true,
  configured: true,
  hasRecipient: true,
  status: "ACTION_REQUIRED",
  payoutReady: false,
  payoutMethodReady: false,
  requirementsDueCount: 1,
  disabledReason: "Bank details need attention",
});
assert.equal(attention.state, "needs_attention");
assert.equal(attention.showContinue, true);
assert.equal(attention.showRefreshStatus, true);
assert.equal(attention.helpCopy, "Bank details need attention");

const ready = deriveGpPayoutUi({
  enabled: true,
  configured: true,
  hasRecipient: true,
  status: "READY",
  payoutReady: true,
  payoutMethodReady: true,
  requirementsDueCount: 0,
  disabledReason: "",
});
assert.equal(ready.statusLine, "Payout ready");
assert.equal(ready.showSetUpPayouts, false);
assert.equal(ready.showContinue, false);

assert.match(GP_GBP_FLAT_FEE_EXPLANATION, /15% of the entire seller amount below/);
assert.match(GP_GBP_FLAT_FEE_EXPLANATION, /11% of the entire seller amount at/);

const reviewSrc = fs.readFileSync(
  path.join(root, "src/components/payments/GpQuoteReview.tsx"),
  "utf8",
);
assert.match(reviewSrc, /action: "prepare" \| "confirm"/);
assert.doesNotMatch(reviewSrc, /useEffect\(/);
assert.match(reviewSrc, /Request a fresh estimate before release/);

const salesSrc = fs.readFileSync(path.join(root, "src/app/profile/sales/page.tsx"), "utf8");
const purchasesSrc = fs.readFileSync(path.join(root, "src/app/profile/purchases/page.tsx"), "utf8");
const cardSrc = fs.readFileSync(path.join(root, "src/components/messaging/PaymentTicketCard.tsx"), "utf8");
const detailSrc = fs.readFileSync(path.join(root, "src/app/profile/purchases/[id]/page.tsx"), "utf8");
assert.match(salesSrc, /sellerReleaseProgressCopy/);
assert.match(salesSrc, /shippedAwaitingReceiptCopy/);
assert.doesNotMatch(salesSrc, /released to your Connect balance/);
assert.match(purchasesSrc, /formatInspectionWindow/);
assert.match(purchasesSrc, /useInspectionDeadlineRefresh/);
assert.match(detailSrc, /gpPayoutProgress/);
assert.match(cardSrc, /formatInspectionWindow/);
assert.match(cardSrc, /hideReleaseActions/);
assert.doesNotMatch(cardSrc, /seller payout waits until delivery\/inspection/);
assert.doesNotMatch(cardSrc + salesSrc + purchasesSrc, /3–6 day|3-6 day/);

console.log("gp unavailable ui states: PASS");
