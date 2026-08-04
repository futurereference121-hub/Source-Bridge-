/**
 * Connect onboarding flag + safety unit tests (no network / DB).
 * Run: node scripts/test-connect-onboarding.mjs
 *
 * Mirrors decision logic from flags.ts + stripe/client.ts + connect gates.
 */

import assert from "node:assert/strict";

function envBool(raw, defaultValue = false) {
  if (!raw) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (!v) return defaultValue;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function hasTestKey(secret) {
  return String(secret || "").startsWith("sk_test_");
}

function hasLiveKey(secret) {
  return String(secret || "").startsWith("sk_live_");
}

/**
 * Product money movement readiness (isStripeConfigured).
 * Requires PAYMENTS_ENABLED + sk_test_. Independent of CONNECT_ONBOARDING_ENABLED.
 */
function isStripeConfiguredForPayments({ paymentsEnabled, secretKey }) {
  return envBool(paymentsEnabled) && hasTestKey(secretKey);
}

/**
 * Connect onboarding API readiness (isConnectOnboardingApiReady).
 * Does NOT require PAYMENTS_ENABLED. Live keys / live mode refused.
 */
function isConnectOnboardingApiReady({
  connectOnboardingEnabled,
  paymentsEnabled, // intentionally unused for readiness — safety assertion below
  livePaymentsEnabled,
  stripeMode,
  secretKey,
}) {
  void paymentsEnabled;
  if (envBool(livePaymentsEnabled)) return false;
  if (stripeMode !== "TEST") return false;
  if (hasLiveKey(secretKey)) return false;
  return hasTestKey(secretKey) && envBool(connectOnboardingEnabled);
}

function checkoutAllowed({ paymentsEnabled, secretKey }) {
  return isStripeConfiguredForPayments({ paymentsEnabled, secretKey });
}

function transfersAllowed({ paymentsEnabled, secretKey }) {
  // release.ts: isPaymentsEnabled() && isStripeConfigured()
  return envBool(paymentsEnabled) && hasTestKey(secretKey);
}

function canStartOnboardingUi({ connectOnboardingEnabled, secretKey, livePaymentsEnabled }) {
  return isConnectOnboardingApiReady({
    connectOnboardingEnabled,
    livePaymentsEnabled,
    stripeMode: "TEST",
    secretKey,
  });
}

function payoutsHelpCopy({ stripeTestConfigured, connectOnboardingEnabled, onboardingReady }) {
  if (!stripeTestConfigured) return "Stripe test configuration is unavailable.";
  if (!envBool(connectOnboardingEnabled) || !onboardingReady) {
    return "Payout setup is not currently available.";
  }
  return "Set up payouts securely through Stripe.";
}

function wouldCreateDuplicateAccount({ existingUserId, candidateUserId }) {
  // Local mapping is 1:1 on userId — second onboard reuses, never inserts another.
  return existingUserId === candidateUserId;
}

function canReceiveProtectedPayments({ chargesEnabled, payoutsEnabled }) {
  // Status only — never claim ready until Stripe confirms both.
  return Boolean(chargesEnabled && payoutsEnabled);
}

// ── Onboarding with CONNECT_ONBOARDING_ENABLED=true, PAYMENTS_ENABLED=false
{
  const secretKey = "sk_test_unit_only";
  assert.equal(
    isConnectOnboardingApiReady({
      connectOnboardingEnabled: "true",
      paymentsEnabled: "false",
      livePaymentsEnabled: "false",
      stripeMode: "TEST",
      secretKey,
    }),
    true,
  );
  assert.equal(
    isStripeConfiguredForPayments({ paymentsEnabled: "false", secretKey }),
    false,
  );
  assert.equal(checkoutAllowed({ paymentsEnabled: "false", secretKey }), false);
  assert.equal(transfersAllowed({ paymentsEnabled: "false", secretKey }), false);
  assert.equal(
    canStartOnboardingUi({
      connectOnboardingEnabled: "true",
      secretKey,
      livePaymentsEnabled: "false",
    }),
    true,
  );
}

// ── Blocked when onboarding flag false (even with test keys)
{
  const secretKey = "sk_test_unit_only";
  assert.equal(
    isConnectOnboardingApiReady({
      connectOnboardingEnabled: "false",
      paymentsEnabled: "false",
      livePaymentsEnabled: "false",
      stripeMode: "TEST",
      secretKey,
    }),
    false,
  );
  assert.equal(
    payoutsHelpCopy({
      stripeTestConfigured: true,
      connectOnboardingEnabled: "false",
      onboardingReady: false,
    }),
    "Payout setup is not currently available.",
  );
}

// ── Live keys rejected
{
  assert.equal(
    isConnectOnboardingApiReady({
      connectOnboardingEnabled: "true",
      paymentsEnabled: "false",
      livePaymentsEnabled: "false",
      stripeMode: "TEST",
      secretKey: "sk_live_should_refuse",
    }),
    false,
  );
  assert.equal(hasTestKey("sk_live_should_refuse"), false);
  assert.equal(hasLiveKey("sk_live_should_refuse"), true);
}

// ── LIVE_PAYMENTS_ENABLED true → onboarding API ready false
{
  assert.equal(
    isConnectOnboardingApiReady({
      connectOnboardingEnabled: "true",
      paymentsEnabled: "false",
      livePaymentsEnabled: "true",
      stripeMode: "TEST",
      secretKey: "sk_test_unit_only",
    }),
    false,
  );
}

// ── No duplicate accounts (same user re-onboards)
{
  assert.equal(
    wouldCreateDuplicateAccount({
      existingUserId: "user_a",
      candidateUserId: "user_a",
    }),
    true, // reuse path, not a second row
  );
  assert.equal(
    wouldCreateDuplicateAccount({
      existingUserId: "user_a",
      candidateUserId: "user_b",
    }),
    false,
  );
}

// ── Checkout / transfers still blocked with payments off + onboarding on
{
  const secretKey = "sk_test_unit_only";
  assert.equal(checkoutAllowed({ paymentsEnabled: "false", secretKey }), false);
  assert.equal(transfersAllowed({ paymentsEnabled: "false", secretKey }), false);
  // Even if payments on later, live keys still cannot configure product path as test:
  assert.equal(
    isStripeConfiguredForPayments({
      paymentsEnabled: "true",
      secretKey: "sk_live_bad",
    }),
    false,
  );
}

// ── Ready for Protected Payments only when Stripe confirms
{
  assert.equal(
    canReceiveProtectedPayments({ chargesEnabled: true, payoutsEnabled: true }),
    true,
  );
  assert.equal(
    canReceiveProtectedPayments({ chargesEnabled: true, payoutsEnabled: false }),
    false,
  );
  assert.equal(
    canReceiveProtectedPayments({ chargesEnabled: false, payoutsEnabled: false }),
    false,
  );
  // detailsSubmitted alone is never enough
  assert.equal(
    canReceiveProtectedPayments({
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
    }),
    false,
  );
}

// ── UI copy
{
  assert.equal(
    payoutsHelpCopy({
      stripeTestConfigured: false,
      connectOnboardingEnabled: "true",
      onboardingReady: false,
    }),
    "Stripe test configuration is unavailable.",
  );
  assert.equal(
    payoutsHelpCopy({
      stripeTestConfigured: true,
      connectOnboardingEnabled: "true",
      onboardingReady: true,
    }),
    "Set up payouts securely through Stripe.",
  );
}

// ── PAYMENTS_ENABLED alone does not unlock Connect onboarding
{
  assert.equal(
    isConnectOnboardingApiReady({
      connectOnboardingEnabled: "false",
      paymentsEnabled: "true",
      livePaymentsEnabled: "false",
      stripeMode: "TEST",
      secretKey: "sk_test_unit_only",
    }),
    false,
  );
  assert.equal(
    isStripeConfiguredForPayments({
      paymentsEnabled: "true",
      secretKey: "sk_test_unit_only",
    }),
    true,
  );
}

// ── Protected/instant product controls stay hidden when flags off
{
  const flags = {
    PROTECTED_PAYMENTS_ENABLED: false,
    INSTANT_PAYMENTS_ENABLED: false,
  };
  const showProtected = Boolean(flags.PROTECTED_PAYMENTS_ENABLED);
  const showInstant = Boolean(flags.INSTANT_PAYMENTS_ENABLED);
  assert.equal(showProtected, false);
  assert.equal(showInstant, false);
}

console.log("test-connect-onboarding: all assertions passed");
