/**
 * Purchases list fixtures. No database, no Stripe, no Production session.
 * Run: node scripts/test-purchases-gp-display.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (process.env.SB_PURCHASES_GP_DISPLAY_TEST !== "1") {
  const env = { ...process.env, SB_PURCHASES_GP_DISPLAY_TEST: "1", NODE_ENV: "test" };
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
const { deriveOutboundDisplayState } = await import(
  "../src/lib/payments/payout-rail/outbound-display.ts"
);
const { derivePurchaseDisplayState } = await import(
  "../src/lib/payments/purchase-display-state.ts"
);
const {
  emptyOrdersListClientState,
  ordersListSinceQuery,
  parseOrdersListBody,
  purchasesPanelState,
  reduceOrdersList,
} = await import("../src/lib/payments/purchase-orders-load.ts");
const { purchaseCardModel, purchasePayoutPhrase } = await import(
  "../src/lib/payments/purchase-list-presentation.ts"
);

const posted = deriveOutboundDisplayState("SUCCEEDED");
assert.equal(posted.buyerLabel, "Released to sourcer");
assert.equal(posted.phase, "completed");

const completedDisplay = derivePurchaseDisplayState({
  status: "RELEASED",
  releasedAt: "2026-10-05T13:31:04.724Z",
});
assert.equal(completedDisplay.label, "Completed");

function releasedActions() {
  return {
    canConfirmReceipt: false,
    canReleaseNow: false,
    canReleaseProcurement: false,
    canReportIssue: false,
  };
}

const completedGp = {
  id: "fixture-gp-completed",
  status: "RELEASED",
  origin: "CHAT_TICKET",
  paymentOption: "PROTECTED",
  title: "Sourcing purchase",
  currency: "GBP",
  itemCostMinor: 2000,
  shippingMinor: 500,
  sellerServiceFeeMinor: 1000,
  protectionFeeMinor: 245,
  totalChargeMinor: 3745,
  stripeMode: "TEST",
  payoutRail: "STRIPE_GLOBAL_PAYOUTS",
  globalPayouts: { phase: posted.phase, buyerLabel: posted.buyerLabel },
  displayState: completedDisplay,
  counterparty: { username: "luckyday", name: "Lucky" },
  actions: releasedActions(),
};

const connectPurchase = {
  id: "fixture-connect-completed",
  status: "RELEASED",
  origin: "PRODUCT_CHECKOUT",
  paymentOption: "PROTECTED",
  title: "Listed product",
  currency: "GBP",
  itemCostMinor: 1500,
  shippingMinor: 200,
  sellerServiceFeeMinor: 0,
  protectionFeeMinor: 119,
  totalChargeMinor: 1819,
  stripeMode: "LIVE",
  payoutRail: "STRIPE_CONNECT",
  globalPayouts: null,
  displayState: completedDisplay,
  counterparty: { username: "northwind", name: "Northwind" },
  actions: releasedActions(),
};

const gpModel = purchaseCardModel(completedGp);
assert.equal(gpModel.seller, "@luckyday");
assert.equal(gpModel.statusLabel, "Completed");
assert.match(gpModel.totalText, /37\.45/);
assert.equal(gpModel.lines.find((line) => line.label === "Item")?.text.includes("20.00"), true);
assert.equal(gpModel.lines.find((line) => line.label === "Shipping")?.text.includes("5.00"), true);
assert.equal(gpModel.lines.find((line) => line.label === "Sourcer fee")?.text.includes("10.00"), true);
assert.equal(gpModel.lines.find((line) => line.label === "Source Bridge fee")?.text.includes("2.45"), true);
assert.equal(
  gpModel.payoutLabel,
  `Global Payouts — ${purchasePayoutPhrase("completed")}`,
);
assert.match(gpModel.payoutLabel, /Payout posted/);
assert.match(gpModel.payoutLabel, /does not confirm the recipient bank has paid/);
assert.doesNotMatch(gpModel.payoutLabel, /Released to sourcer/);
assert.equal(gpModel.quoteKind, null);
assert.equal(gpModel.offersQuoteConfirmation, false);
assert.equal(gpModel.offersRelease, false);

const connectModel = purchaseCardModel(connectPurchase);
assert.equal(connectModel.seller, "@northwind");
assert.equal(connectModel.payoutLabel, null);
assert.equal(connectModel.offersQuoteConfirmation, false);
assert.match(connectModel.totalText, /18\.19/);

const closedLive = purchaseCardModel({
  ...completedGp,
  id: "fixture-gp-live-closed",
  stripeMode: "LIVE",
  actions: { canReleaseNow: true, canReleaseProcurement: true },
});
assert.equal(closedLive.quoteKind, null);
assert.equal(closedLive.offersQuoteConfirmation, false);

const openLive = purchaseCardModel({
  status: "DELIVERED",
  stripeMode: "LIVE",
  payoutRail: "STRIPE_GLOBAL_PAYOUTS",
  actions: { canReleaseNow: true },
  currency: "GBP",
  totalChargeMinor: 3745,
});
assert.equal(openLive.quoteKind, "FINAL");
assert.equal(openLive.offersQuoteConfirmation, true);
assert.equal(openLive.offersRelease, true);

const payoutPhrases = {
  awaiting_funds: purchasePayoutPhrase("awaiting_funds"),
  awaiting_minimum: purchasePayoutPhrase("awaiting_minimum"),
  pending: purchasePayoutPhrase("pending"),
  processing: purchasePayoutPhrase("processing"),
  completed: purchasePayoutPhrase("completed"),
  failed: purchasePayoutPhrase("failed"),
  returned: purchasePayoutPhrase("returned"),
};
assert.match(payoutPhrases.awaiting_funds, /Release authorized/);
assert.match(payoutPhrases.awaiting_minimum, /Release authorized/);
assert.match(payoutPhrases.pending, /Payout pending/);
assert.match(payoutPhrases.processing, /Payout confirming/);
assert.match(payoutPhrases.completed, /Payout posted/);
assert.match(payoutPhrases.failed, /Payout failed/);
assert.match(payoutPhrases.returned, /Payout returned/);
assert.equal(new Set(Object.values(payoutPhrases)).size, 7);
for (const phrase of Object.values(payoutPhrases)) {
  assert.doesNotMatch(String(phrase), /Released to sourcer|recipient has received|has been paid/i);
}

const buyerScope = { ...emptyOrdersListClientState(), scope: "buyer:acct" };
const mixed = [
  completedGp,
  connectPurchase,
  ...Array.from({ length: 23 }, (_, index) => ({
    ...connectPurchase,
    id: `fixture-connect-${index}`,
    title: `Listed product ${index + 1}`,
  })),
];
assert.equal(mixed.length, 25);

let state = emptyOrdersListClientState();
const unchangedFirst = reduceOrdersList(state, {
  seq: 2,
  latestSeq: 2,
  parsed: parseOrdersListBody({ ok: true, unchanged: true, ordersVersion: 100 }, true),
});
assert.equal(unchangedFirst.followUp, "force");
assert.equal(unchangedFirst.state.orders.length, 0);
assert.equal(unchangedFirst.state.hasAppliedOrders, false);
assert.equal(unchangedFirst.state.ordersVersion, 0);
assert.equal(ordersListSinceQuery(unchangedFirst.state), "");
assert.equal(ordersListSinceQuery(unchangedFirst.state, true), "");
assert.equal(
  purchasesPanelState({ loading: true, error: "", count: 0 }),
  "loading",
);

const recovered = reduceOrdersList(unchangedFirst.state, {
  seq: 1,
  latestSeq: 2,
  parsed: parseOrdersListBody(
    { ok: true, orders: mixed, ordersVersion: 100 },
    true,
  ),
});
assert.equal(recovered.state.orders.length, 25);
assert.equal(recovered.state.ordersVersion, 100);
assert.equal(ordersListSinceQuery(recovered.state), "&sinceVersion=100");
assert.equal(ordersListSinceQuery(recovered.state, true), "");
assert.equal(
  recovered.state.orders.some((row) => row.id === "fixture-gp-completed"),
  true,
);
assert.equal(
  recovered.state.orders.some((row) => row.payoutRail === "STRIPE_CONNECT"),
  true,
);
assert.equal(
  purchasesPanelState({ loading: false, error: "", count: recovered.state.orders.length }),
  "list",
);

state = emptyOrdersListClientState();
const emptyApplied = reduceOrdersList(state, {
  seq: 1,
  latestSeq: 1,
  parsed: parseOrdersListBody({ ok: true, orders: [], ordersVersion: 0 }, true),
});
assert.equal(emptyApplied.state.hasAppliedOrders, true);
assert.equal(emptyApplied.state.orders.length, 0);
assert.equal(
  purchasesPanelState({ loading: false, error: "", count: 0 }),
  "empty",
);

const failed = reduceOrdersList(emptyOrdersListClientState(), {
  seq: 1,
  latestSeq: 1,
  parsed: parseOrdersListBody(null, false, "Failed to load orders"),
});
assert.equal(failed.state.orders.length, 0);
assert.equal(failed.state.error, "Failed to load orders");
assert.equal(
  purchasesPanelState({ loading: false, error: failed.state.error, count: 0 }),
  "error",
);
assert.notEqual(failed.state.error, "No purchases yet.");

const malformed = reduceOrdersList(emptyOrdersListClientState(), {
  seq: 1,
  latestSeq: 1,
  parsed: parseOrdersListBody({ ok: true }, true),
});
assert.equal(malformed.state.error, "Failed to load orders");
assert.equal(
  purchasesPanelState({ loading: false, error: malformed.state.error, count: 0 }),
  "error",
);

const kept = reduceOrdersList(recovered.state, {
  seq: 4,
  latestSeq: 4,
  parsed: parseOrdersListBody(null, false, "Failed to load orders"),
});
assert.equal(kept.state.orders.length, 25);
assert.equal(
  purchasesPanelState({ loading: false, error: "", count: kept.state.orders.length }),
  "list",
);

const failedNewer = reduceOrdersList(buyerScope, {
  seq: 2,
  latestSeq: 2,
  scope: "buyer:acct",
  parsed: parseOrdersListBody(null, false, "Failed to load orders"),
});
assert.equal(failedNewer.state.orders.length, 0);
const olderFull = reduceOrdersList(failedNewer.state, {
  seq: 1,
  latestSeq: 2,
  scope: "buyer:acct",
  parsed: parseOrdersListBody({ ok: true, orders: [completedGp], ordersVersion: 80 }, true),
});
assert.equal(olderFull.state.orders.length, 1);
assert.equal(olderFull.state.error, "");
assert.equal(olderFull.state.ordersVersion, 80);

const otherAccount = reduceOrdersList(
  { ...emptyOrdersListClientState(), scope: "buyer:other" },
  {
    seq: 1,
    latestSeq: 2,
    scope: "buyer:acct",
    parsed: parseOrdersListBody({ ok: true, orders: mixed, ordersVersion: 80 }, true),
  },
);
assert.equal(otherAccount.state.orders.length, 0);
assert.equal(otherAccount.state.ordersVersion, 0);
assert.equal(otherAccount.state.scope, "buyer:other");

const signedOut = reduceOrdersList(emptyOrdersListClientState(), {
  seq: 1,
  latestSeq: 1,
  scope: "buyer:acct",
  parsed: parseOrdersListBody({ ok: true, orders: mixed, ordersVersion: 80 }, true),
});
assert.equal(signedOut.state.orders.length, 0);
assert.equal(signedOut.state.ordersVersion, 0);

const sellerScope = { ...emptyOrdersListClientState(), scope: "seller:acct" };
const wrongRole = reduceOrdersList(sellerScope, {
  seq: 1,
  latestSeq: 2,
  scope: "buyer:acct",
  parsed: parseOrdersListBody({ ok: true, orders: mixed, ordersVersion: 10 }, true),
});
assert.equal(wrongRole.state.orders.length, 0);
const sellerList = reduceOrdersList(sellerScope, {
  seq: 1,
  latestSeq: 1,
  scope: "seller:acct",
  parsed: parseOrdersListBody({ ok: true, orders: [connectPurchase], ordersVersion: 10 }, true),
});
assert.equal(sellerList.state.orders.length, 1);
assert.equal(sellerList.state.scope, "seller:acct");
assert.equal(ordersListSinceQuery(sellerList.state), "&sinceVersion=10");

const page = fs.readFileSync(path.join(root, "src/app/profile/purchases/page.tsx"), "utf8");
const detail = fs.readFileSync(path.join(root, "src/app/profile/purchases/[id]/page.tsx"), "utf8");
const fulfilment = fs.readFileSync(path.join(root, "src/lib/payments/fulfilment.ts"), "utf8");
assert.match(page, /purchasesPanelState/);
assert.match(page, /purchaseCardModel/);
assert.match(page, /PurchaseRecordedAmounts/);
assert.match(page, /quoteKind === "FINAL"/);
assert.match(page, /quoteKind === "PROCUREMENT"/);
assert.doesNotMatch(page, /quoteConfirmationRequired/);
assert.match(detail, /purchaseCardModel/);
assert.match(detail, /model\?\.quoteKind/);
assert.match(fulfilment, /globalPayouts: globalPayoutsBuyerDisplay/);
assert.match(fulfilment, /select: \{ status: true, failureCode: true \}/);
assert.doesNotMatch(
  fulfilment.slice(fulfilment.indexOf("outboundPaymentAttempts:")),
  /stripeOutboundPaymentId|stripeRecipientId|failureMessage/,
);

const hook = fs.readFileSync(path.join(root, "src/hooks/useProtectedOrders.ts"), "utf8");
const quote = fs.readFileSync(
  path.join(root, "src/components/payments/GpQuoteReview.tsx"),
  "utf8",
);
const sales = fs.readFileSync(path.join(root, "src/app/profile/sales/page.tsx"), "utf8");
assert.match(hook, /ordersListSinceQuery/);
assert.match(hook, /requestScope !== stateRef\.current\.scope/);
assert.match(hook, /generationRef\.current \+= 1/);
assert.doesNotMatch(quote, /useEffect/);
assert.match(quote, /action: "prepare" \| "confirm"/);
assert.doesNotMatch(page, /global-payouts\/quote/);
assert.doesNotMatch(detail, /global-payouts\/quote/);
assert.doesNotMatch(detail, /method:\s*"POST"/);
assert.match(detail, /\/api\/payments\/orders\?role=buyer/);
assert.match(sales, /useProtectedOrders/);
assert.match(sales, /role: "seller"/);
assert.match(sales, /accountId: account\?\.id/);
assert.doesNotMatch(sales, /STRIPE_GLOBAL_PAYOUTS/);

function cardHtml(model, title) {
  const lines = model.lines
    .map(
      (line) =>
        `<div><dt>${line.label}</dt><dd>${line.text}</dd></div>`,
    )
    .join("");
  const payout = model.payoutLabel
    ? `<div class="wide"><dt>Payout</dt><dd>${model.payoutLabel}</dd></div>`
    : "";
  const controls = model.offersQuoteConfirmation || model.offersRelease
    ? `<p class="controls">Release controls</p>`
    : "";
  return `<article class="card">
    <div class="head">
      <div><h2>${title}</h2><p class="status">${model.statusLabel}</p><p>Seller: ${model.seller}</p></div>
      <p class="total">${model.totalText}</p>
    </div>
    <dl>${lines}${payout}</dl>
    ${controls}
  </article>`;
}

const preview = `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Purchases fixtures</title>
<style>
  body { margin: 0; background: #020b1c; color: #fff; font: 14px/1.4 system-ui, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 32px; margin: 0 0 8px; }
  section { margin-top: 28px; }
  h3 { margin: 0 0 8px; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: rgba(255,255,255,.45); }
  .card { border: 1px solid rgba(255,255,255,.1); border-radius: 12px; padding: 20px; margin-top: 12px; }
  .head, dl { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; }
  dl { display: grid; grid-template-columns: 1fr; gap: 8px; margin: 16px 0 0; }
  @media (min-width: 640px) { dl { grid-template-columns: 1fr 1fr; } .wide { grid-column: 1 / -1; } }
  dt { color: rgba(255,255,255,.4); }
  .status { color: #93c5fd; font-size: 12px; letter-spacing: .08em; }
  .total { font-weight: 600; }
  .muted { color: rgba(255,255,255,.55); }
  .error { color: #fde68a; }
  a { color: #93c5fd; }
</style>
<body>
<main>
  <p class="status">Account</p>
  <h1>Purchases</h1>
  <section>
    <h3>Completed Global Payouts</h3>
    ${cardHtml(gpModel, gpModel.title)}
  </section>
  <section>
    <h3>Mixed Connect and Global Payouts</h3>
    ${cardHtml(gpModel, gpModel.title)}
    ${cardHtml(connectModel, connectModel.title)}
  </section>
  <section>
    <h3>Empty list</h3>
    <p class="muted">No purchases yet.</p>
  </section>
  <section>
    <h3>Failed request</h3>
    <p class="error">Failed to load orders</p>
    <p><a href="#retry">Try again</a></p>
  </section>
</main>
</body>
</html>`;

assert.equal(preview.includes("No purchases yet."), true);
assert.equal(preview.includes("Failed to load orders"), true);
assert.equal(preview.includes("Review estimate"), false);
assert.equal(preview.includes("Release Funds Now"), false);
assert.equal(preview.includes("@luckyday"), true);
assert.match(preview, /Payout posted/);
assert.doesNotMatch(preview, /Released to sourcer/);
assert.doesNotMatch(preview, /Review estimate|Release Funds Now/);

if (process.env.SB_PURCHASES_PREVIEW === "1") {
  const previewPath = path.join(root, "tmp-purchases-gp-preview.html");
  fs.writeFileSync(previewPath, preview);
  console.log(previewPath);
}

console.log("[test-purchases-gp-display] passed");
