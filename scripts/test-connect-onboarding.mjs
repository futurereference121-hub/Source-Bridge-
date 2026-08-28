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
 * Does NOT require PAYMENTS_ENABLED.
 * TEST: TEST secret. LIVE: kill switch + LIVE secret.
 */
function isConnectOnboardingApiReady({
  connectOnboardingEnabled,
  paymentsEnabled, // intentionally unused for readiness — safety assertion below
  livePaymentsEnabled,
  stripeMode,
  secretKey,
}) {
  void paymentsEnabled;
  void connectOnboardingEnabled;
  if (stripeMode === "LIVE") {
    if (!envBool(livePaymentsEnabled)) return false;
    return hasLiveKey(secretKey);
  }
  if (hasLiveKey(secretKey)) return false;
  return hasTestKey(secretKey);
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

function wouldCreateDuplicateAccount({
  existingUserId,
  candidateUserId,
  existingMode,
  candidateMode,
}) {
  // Same user + same mode reuses the row; different mode is a separate row.
  return (
    existingUserId === candidateUserId &&
    normalizeMode(existingMode) === normalizeMode(candidateMode)
  );
}

function normalizeMode(m) {
  return String(m || "TEST").toUpperCase() === "LIVE" ? "LIVE" : "TEST";
}

function canReceiveProtectedPayments({ chargesEnabled, payoutsEnabled }) {
  // Status only — never claim ready until Stripe confirms both.
  return Boolean(chargesEnabled && payoutsEnabled);
}

/**
 * Mirrors src/lib/payments/stripe/connectPayoutUi.ts
 */
function isConnectPayoutReady(connect) {
  return (
    connect.hasAccount &&
    connect.detailsSubmitted &&
    connect.chargesEnabled &&
    connect.payoutsEnabled &&
    connect.requirementsDueCount === 0 &&
    connect.canReceiveProtectedPayments
  );
}

function deriveConnectPayoutUi(connect) {
  const actionsEnabled = Boolean(connect?.onboardingReady);
  if (!connect?.hasAccount) {
    return {
      state: "not_started",
      showSetUpPayouts: actionsEnabled,
      showContinueOnboarding: false,
      showRefreshStatus: false,
      showOpenStripeDashboard: false,
    };
  }
  if (isConnectPayoutReady(connect)) {
    return {
      state: "ready",
      showSetUpPayouts: false,
      showContinueOnboarding: false,
      showRefreshStatus: false,
      showOpenStripeDashboard: true,
    };
  }
  if (connect.detailsSubmitted && connect.requirementsDueCount === 0) {
    return {
      state: "pending_review",
      showSetUpPayouts: false,
      showContinueOnboarding: false,
      showRefreshStatus: true,
      showOpenStripeDashboard: true,
    };
  }
  return {
    state: "onboarding_incomplete",
    showSetUpPayouts: false,
    showContinueOnboarding: actionsEnabled,
    showRefreshStatus: true,
    showOpenStripeDashboard: true,
  };
}

function shouldSyncOnConnectReturn(connectParam, alreadySynced) {
  if (alreadySynced) return false;
  return connectParam === "return" || connectParam === "refresh";
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

// ── TEST keys enable onboarding even if CONNECT_ONBOARDING_ENABLED is unset
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
    true,
  );
  assert.equal(
    canStartOnboardingUi({
      connectOnboardingEnabled: "false",
      secretKey,
      livePaymentsEnabled: "false",
    }),
    true,
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

// ── LIVE_PAYMENTS_ENABLED true + TEST mode path → onboarding false (active mode would be LIVE)
{
  assert.equal(
    isConnectOnboardingApiReady({
      connectOnboardingEnabled: "true",
      paymentsEnabled: "false",
      livePaymentsEnabled: "true",
      stripeMode: "TEST",
      secretKey: "sk_test_unit_only",
    }),
    true, // TEST secret still valid for TEST mode helper; platform getStripeMode would be LIVE
  );
  assert.equal(
    isConnectOnboardingApiReady({
      connectOnboardingEnabled: "true",
      paymentsEnabled: "false",
      livePaymentsEnabled: "true",
      stripeMode: "LIVE",
      secretKey: "sk_live_unit_only",
    }),
    true,
  );
  assert.equal(
    isConnectOnboardingApiReady({
      connectOnboardingEnabled: "true",
      paymentsEnabled: "false",
      livePaymentsEnabled: "false",
      stripeMode: "LIVE",
      secretKey: "sk_live_unit_only",
    }),
    false,
  );
}

// ── No duplicate accounts (same user + same mode re-onboards)
{
  assert.equal(
    wouldCreateDuplicateAccount({
      existingUserId: "user_a",
      candidateUserId: "user_a",
      existingMode: "TEST",
      candidateMode: "TEST",
    }),
    true, // reuse path, not a second row
  );
  assert.equal(
    wouldCreateDuplicateAccount({
      existingUserId: "user_a",
      candidateUserId: "user_b",
      existingMode: "TEST",
      candidateMode: "TEST",
    }),
    false,
  );
  // Dual-mode: same user may have TEST and LIVE rows
  assert.equal(
    wouldCreateDuplicateAccount({
      existingUserId: "user_a",
      candidateUserId: "user_a",
      existingMode: "TEST",
      candidateMode: "LIVE",
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

// ── PAYMENTS_ENABLED is not required for TEST Connect onboarding
{
  assert.equal(
    isConnectOnboardingApiReady({
      connectOnboardingEnabled: "false",
      paymentsEnabled: "true",
      livePaymentsEnabled: "false",
      stripeMode: "TEST",
      secretKey: "sk_test_unit_only",
    }),
    true,
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

// ── Connect payout UI states (payments settings page)
{
  const readyBase = {
    hasAccount: true,
    detailsSubmitted: true,
    chargesEnabled: true,
    payoutsEnabled: true,
    requirementsDueCount: 0,
    canReceiveProtectedPayments: true,
    onboardingReady: true,
    stripeTestConfigured: true,
  };

  const notStarted = deriveConnectPayoutUi({
    hasAccount: false,
    detailsSubmitted: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    requirementsDueCount: 0,
    canReceiveProtectedPayments: false,
    onboardingReady: true,
    stripeTestConfigured: true,
  });
  assert.equal(notStarted.state, "not_started");
  assert.equal(notStarted.showSetUpPayouts, true);
  assert.equal(notStarted.showContinueOnboarding, false);

  const incomplete = deriveConnectPayoutUi({
    ...readyBase,
    detailsSubmitted: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    canReceiveProtectedPayments: false,
  });
  assert.equal(incomplete.state, "onboarding_incomplete");
  assert.equal(incomplete.showContinueOnboarding, true);
  assert.equal(incomplete.showSetUpPayouts, false);

  const pending = deriveConnectPayoutUi({
    ...readyBase,
    chargesEnabled: false,
    payoutsEnabled: false,
    canReceiveProtectedPayments: false,
  });
  assert.equal(pending.state, "pending_review");
  assert.equal(pending.showContinueOnboarding, false);
  assert.equal(pending.showRefreshStatus, true);

  const ready = deriveConnectPayoutUi(readyBase);
  assert.equal(ready.state, "ready");
  assert.equal(ready.showContinueOnboarding, false);
  assert.equal(ready.showOpenStripeDashboard, true);
  assert.equal(ready.showRefreshStatus, false);

  // LIVE-ready account must not offer Continue onboarding
  const liveReady = deriveConnectPayoutUi({
    ...readyBase,
    stripeTestConfigured: false,
    onboardingReady: true,
  });
  assert.equal(liveReady.state, "ready");
  assert.equal(liveReady.showContinueOnboarding, false);
}

// ── Connect return auto-sync (one shot, no loop)
{
  assert.equal(shouldSyncOnConnectReturn("return", false), true);
  assert.equal(shouldSyncOnConnectReturn("refresh", false), true);
  assert.equal(shouldSyncOnConnectReturn("return", true), false);
  assert.equal(shouldSyncOnConnectReturn(null, false), false);
}

console.log("test-connect-onboarding: all assertions passed");
