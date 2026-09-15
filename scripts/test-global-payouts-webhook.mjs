/**
 * Global Payouts thin-event webhook signature tests (offline, no Stripe network).
 * Run: node --experimental-strip-types scripts/test-global-payouts-webhook.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import Stripe from "stripe";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// Resolve TS via experimental strip-types by dynamic import of absolute file URL.
const verifyModUrl = pathToFileURL(
  path.join(root, "src/lib/payments/payout-rail/webhook-verify.ts"),
).href;

const {
  verifyGlobalPayoutsThinEvent,
  normalizeWebhookSecret,
  isGlobalPayoutsEventDestinationPing,
  GP_EVENT_DESTINATION_PING,
  GpWebhookVerifyError,
} = await import(verifyModUrl);

const stripe = new Stripe("sk_test_webhook_unit_only", { typescript: true });
const SECRET = "whsec_test_gp_thin_unit_secret";

function signedThin(body, secret = SECRET) {
  const payload = JSON.stringify(body);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return { payload, header };
}

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

// Source contracts
{
  const route = fs.readFileSync(
    path.join(root, "src/app/api/webhooks/stripe/global-payouts/route.ts"),
    "utf8",
  );
  ok("route uses verifyGlobalPayoutsThinEvent", route.includes("verifyGlobalPayoutsThinEvent"));
  ok("route does not call constructEvent directly", !route.includes("constructEvent"));
  ok("route uses req.text() raw body", route.includes("await req.text()"));
  ok(
    "route short-circuits ping before handler",
    route.includes("isGlobalPayoutsEventDestinationPing") &&
      route.indexOf("ping_ack") < route.indexOf("handleGlobalPayoutsThinEvent({"),
  );

  const verifySrc = fs.readFileSync(
    path.join(root, "src/lib/payments/payout-rail/webhook-verify.ts"),
    "utf8",
  );
  ok("verify uses parseThinEvent", verifySrc.includes("parseThinEvent"));
}

ok(
  "normalize strips surrounding quotes",
  normalizeWebhookSecret('  "whsec_abc"  ') === "whsec_abc",
);

ok(
  "ping type constant",
  GP_EVENT_DESTINATION_PING === "v2.core.event_destination.ping" &&
    isGlobalPayoutsEventDestinationPing("v2.core.event_destination.ping") &&
    !isGlobalPayoutsEventDestinationPing("v2.money_management.outbound_payment.created"),
);

// Valid thin-event signature succeeds
{
  process.env.STRIPE_GP_WEBHOOK_SECRET_TEST = SECRET;
  delete process.env.STRIPE_GP_WEBHOOK_SECRET_LIVE;
  delete process.env.STRIPE_GP_WEBHOOK_SECRET;
  const body = {
    id: "evt_test_gp_thin_1",
    object: "v2.core.event",
    type: "v2.money_management.outbound_payment.created",
    livemode: false,
    created: "2024-01-01T00:00:00.000Z",
    related_object: {
      id: "obp_test_1",
      type: "v2.money_management.outbound_payment",
      url: "/v2/money_management/outbound_payments/obp_test_1",
    },
  };
  const { payload, header } = signedThin(body);
  const { thinEvent, verifiedMode } = verifyGlobalPayoutsThinEvent(payload, header);
  ok("valid thin signature succeeds", thinEvent.id === "evt_test_gp_thin_1");
  ok("valid thin type preserved", thinEvent.type === body.type);
  ok("valid thin related_object", thinEvent.related_object?.id === "obp_test_1");
  ok("verified mode TEST", verifiedMode === "TEST");
}

// Invalid signature → 400
{
  process.env.STRIPE_GP_WEBHOOK_SECRET_TEST = SECRET;
  const body = {
    id: "evt_test_gp_bad",
    object: "v2.core.event",
    type: "v2.core.event_destination.ping",
    livemode: false,
    created: "2024-01-01T00:00:00.000Z",
    related_object: null,
  };
  const { payload } = signedThin(body);
  const badHeader = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_wrong_secret_zzzzzzzz",
  });
  let caught = null;
  try {
    verifyGlobalPayoutsThinEvent(payload, badHeader);
  } catch (err) {
    caught = err;
  }
  ok("invalid signature throws", caught instanceof GpWebhookVerifyError);
  ok("invalid signature status 400", caught?.status === 400);
  ok("invalid signature code", caught?.code === "WEBHOOK_SIG_INVALID");
}

// Missing secret → 503 (not masked as Invalid signature)
{
  delete process.env.STRIPE_GP_WEBHOOK_SECRET_TEST;
  delete process.env.STRIPE_GP_WEBHOOK_SECRET_LIVE;
  delete process.env.STRIPE_GP_WEBHOOK_SECRET;
  delete process.env.STRIPE_GP_WEBHOOK_SECRET_TEST_2;
  delete process.env.STRIPE_GP_WEBHOOK_SECRET_LIVE_2;
  const body = {
    id: "evt_test_gp_nosecret",
    object: "v2.core.event",
    type: "v2.core.event_destination.ping",
    livemode: false,
    created: "2024-01-01T00:00:00.000Z",
    related_object: null,
  };
  const { payload, header } = signedThin(body);
  let caught = null;
  try {
    verifyGlobalPayoutsThinEvent(payload, header);
  } catch (err) {
    caught = err;
  }
  ok("missing secret throws", caught instanceof GpWebhookVerifyError);
  ok("missing secret status 503", caught?.status === 503);
  ok("missing secret code", caught?.code === "WEBHOOK_SECRET_MISSING");
}

// Correctly signed ping verifies; handler path is mutation-free (source + action)
{
  process.env.STRIPE_GP_WEBHOOK_SECRET_TEST = SECRET;
  const body = {
    id: "evt_test_gp_ping",
    object: "v2.core.event",
    type: "v2.core.event_destination.ping",
    livemode: false,
    created: "2024-01-01T00:00:00.000Z",
    related_object: null,
  };
  const { payload, header } = signedThin(body);
  const { thinEvent } = verifyGlobalPayoutsThinEvent(payload, header);
  ok("signed ping verifies", thinEvent.type === GP_EVENT_DESTINATION_PING);
  ok("signed ping is ping helper", isGlobalPayoutsEventDestinationPing(thinEvent.type));

  const eventsSrc = fs.readFileSync(
    path.join(root, "src/lib/payments/payout-rail/events.ts"),
    "utf8",
  );
  ok(
    "handler returns ping_ack before any prisma write",
    eventsSrc.includes('return { action: "ping_ack" }') &&
      eventsSrc.indexOf("isGlobalPayoutsEventDestinationPing") <
        eventsSrc.indexOf("prisma.processedWebhookEvent"),
  );
}

// Relevant GP lifecycle thin event continues through verify → handler contract
{
  process.env.STRIPE_GP_WEBHOOK_SECRET_TEST = SECRET;
  const body = {
    id: "evt_test_gp_recipient",
    object: "v2.core.event",
    type: "v2.money_management.outbound_payment.posted",
    livemode: false,
    created: "2024-01-01T00:00:00.000Z",
    related_object: {
      id: "obp_test_posted",
      type: "v2.money_management.outbound_payment",
      url: "/v2/money_management/outbound_payments/obp_test_posted",
    },
  };
  const { payload, header } = signedThin(body);
  const { thinEvent } = verifyGlobalPayoutsThinEvent(payload, header);
  ok(
    "GP outbound thin event verifies for handler",
    thinEvent.type.includes("outbound_payment") &&
      thinEvent.related_object?.id === "obp_test_posted" &&
      !isGlobalPayoutsEventDestinationPing(thinEvent.type),
  );

  const eventsSrc = fs.readFileSync(
    path.join(root, "src/lib/payments/payout-rail/events.ts"),
    "utf8",
  );
  ok(
    "handler still reconciles outbound_payment types",
    eventsSrc.includes('type.includes("outbound_payment")') &&
      eventsSrc.includes("reconcileOutboundFromEvent"),
  );
  ok(
    "handler still syncs recipient/payout_method",
    eventsSrc.includes("syncGlobalPayoutRecipientByStripeId") &&
      eventsSrc.includes('type.includes("payout_method")'),
  );
}

// parseThinEvent parity with constructEvent for thin payloads (SDK sanity)
{
  const body = {
    id: "evt_sdk_parity",
    object: "v2.core.event",
    type: "v2.core.event_destination.ping",
    livemode: false,
    related_object: null,
  };
  const { payload, header } = signedThin(body);
  const viaParse = stripe.parseThinEvent(payload, header, SECRET);
  const viaConstruct = stripe.webhooks.constructEvent(payload, header, SECRET);
  ok("parseThinEvent id matches constructEvent", viaParse.id === viaConstruct.id);
  ok("parseThinEvent type matches", viaParse.type === viaConstruct.type);
}

void require;

console.log(`\nOK ${passed} global-payouts-webhook checks passed`);
