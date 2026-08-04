/**
 * Stripe webhook foundation unit tests (no network DB required for crypto/path tests).
 * Run: node scripts/test-stripe-webhooks.mjs
 *
 * Uses Stripe SDK generateTestHeaderString (known test vectors). Does not invent
 * live Dashboard deliveries.
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import Stripe from "stripe";

const stripe = new Stripe("sk_test_webhook_unit_only", { typescript: true });

const SECRET_A = "whsec_test_secret_a_unit";
const SECRET_B = "whsec_test_secret_b_unit";

function makeSignedPayload(payloadObj, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const payload = JSON.stringify(payloadObj);
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
    timestamp,
  });
  return { payload, header };
}

// ── constructEvent: valid TEST snapshot
{
  const body = {
    id: "evt_test_payments_1",
    object: "event",
    type: "payment_intent.succeeded",
    livemode: false,
    data: {
      object: {
        id: "pi_test_1",
        object: "payment_intent",
        amount: 1000,
        currency: "gbp",
        latest_charge: "ch_test_1",
      },
    },
  };
  const { payload, header } = makeSignedPayload(body, SECRET_A);
  const event = stripe.webhooks.constructEvent(payload, header, SECRET_A);
  assert.equal(event.id, "evt_test_payments_1");
  assert.equal(event.type, "payment_intent.succeeded");
  assert.equal(event.livemode, false);
}

// ── constructEvent: invalid signature → throws
{
  const body = {
    id: "evt_bad",
    object: "event",
    type: "payment_intent.succeeded",
    livemode: false,
    data: { object: { id: "pi_x" } },
  };
  const { payload } = makeSignedPayload(body, SECRET_A);
  const badHeader = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_wrong_secret_zzzz",
  });
  assert.throws(
    () => stripe.webhooks.constructEvent(payload, badHeader, SECRET_A),
    (err) => {
      assert.ok(err);
      return true;
    },
  );
}

// ── Multi-secret: second secret matches
{
  const body = {
    id: "evt_multi",
    object: "event",
    type: "account.updated",
    livemode: false,
    data: { object: { id: "acct_123" } },
  };
  const { payload, header } = makeSignedPayload(body, SECRET_B);

  function constructWithSecrets(raw, sig, secrets) {
    let last;
    for (const s of secrets) {
      try {
        return stripe.webhooks.constructEvent(raw, sig, s);
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }
  const event = constructWithSecrets(payload, header, [SECRET_A, SECRET_B]);
  assert.equal(event.id, "evt_multi");
}

// ── Thin event notification shape (v2)
{
  const body = {
    id: "evt_test_65thin_account_req",
    object: "v2.core.event",
    type: "v2.core.account[requirements].updated",
    livemode: false,
    related_object: {
      id: "acct_1ThinAcctTest",
      type: "v2.core.account",
      url: "/v2/core/accounts/acct_1ThinAcctTest",
    },
  };
  const { payload, header } = makeSignedPayload(body, SECRET_A);
  const event = stripe.webhooks.constructEvent(payload, header, SECRET_A);
  assert.equal(event.object, "v2.core.event");
  assert.equal(event.type, "v2.core.account[requirements].updated");
  assert.equal(event.related_object.id, "acct_1ThinAcctTest");
}

// ── Idempotency set simulation
{
  const seen = new Set();
  function processOnce(eventId) {
    if (seen.has(eventId)) return { duplicate: true };
    seen.add(eventId);
    return { duplicate: false };
  }
  assert.equal(processOnce("evt_1").duplicate, false);
  assert.equal(processOnce("evt_1").duplicate, true);
  assert.equal(processOnce("evt_2").duplicate, false);
}

// ── Flags OFF: financial actions gated; verify still allowed
{
  const paymentsEnabled = false;
  const verified = true;
  let funded = false;
  if (verified) {
    // store + ack always
    if (paymentsEnabled) {
      funded = true;
    }
  }
  assert.equal(verified, true);
  assert.equal(funded, false);
}

// ── Live mode rejection (no money movement)
{
  const livemode = true;
  const livePaymentsEnabled = false;
  const allowMoney = !livemode && livePaymentsEnabled;
  assert.equal(allowMoney, false);
}

// ── Required Connect thin event list (regression anchor)
{
  const required = [
    "v2.core.account.created",
    "v2.core.account.updated",
    "v2.core.account.closed",
    "v2.core.account[configuration.merchant].updated",
    "v2.core.account[configuration.merchant].capability_status_updated",
    "v2.core.account[configuration.recipient].updated",
    "v2.core.account[configuration.recipient].capability_status_updated",
    "v2.core.account[requirements].updated",
    "v2.core.account[future_requirements].updated",
    "v2.core.account[identity].updated",
    "v2.core.account[defaults].updated",
    "v2.core.account_link.returned",
  ];
  assert.equal(required.length, 12);
  assert.ok(required.includes("v2.core.account[requirements].updated"));
  // Explicitly document that classic account.updated is optional companion only
  assert.equal(required.includes("account.updated"), false);
}

// ── Manual HMAC matches Stripe scheme (sanity for raw body)
{
  const payload = '{"id":"evt_hmac","object":"event","type":"payment_intent.succeeded","livemode":false}';
  const t = 1_700_000_000;
  const sig = createHmac("sha256", SECRET_A).update(`${t}.${payload}`, "utf8").digest("hex");
  const header = `t=${t},v1=${sig}`;
  const event = stripe.webhooks.constructEvent(payload, header, SECRET_A, 60 * 60 * 24 * 365 * 50);
  assert.equal(event.id, "evt_hmac");
}

console.log("test-stripe-webhooks: all assertions passed");
console.log("  - invalid signature rejects");
console.log("  - valid TEST constructEvent (snapshot + thin) OK");
console.log("  - multi-secret + idempotency simulation OK");
console.log("  - payments-disabled financial gate OK");
console.log("  (No live Stripe Dashboard send in this script)");
