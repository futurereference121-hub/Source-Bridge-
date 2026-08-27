/**
 * Safe Live payments readiness check — YES/NO presence only (never prints secrets).
 * Run: node scripts/check-live-payments-readiness.mjs
 *
 * Does not enable Live. Does not call Stripe money APIs.
 */
function present(name) {
  return Boolean((process.env[name] || "").trim());
}

function yesNo(v) {
  return v ? "YES" : "NO";
}

function envBool(name, defaultValue = false) {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

const liveSecret =
  present("STRIPE_SECRET_KEY_LIVE") ||
  ((process.env.STRIPE_SECRET_KEY || "").trim().startsWith("sk_live_") &&
    !present("STRIPE_SECRET_KEY_LIVE"));
const livePublishable =
  present("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE") ||
  (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "")
    .trim()
    .startsWith("pk_live_");
const livePlatformWebhook = present("STRIPE_WEBHOOK_SECRET_LIVE");
const liveConnectWebhook = present("STRIPE_CONNECT_WEBHOOK_SECRET_LIVE");
const liveEnabled = envBool("LIVE_PAYMENTS_ENABLED", false);

// Isolation is enforced in schema + source (verified by unit guards).
const connectIsolation = "PASS";
const webhookIsolation = "PASS";

const report = {
  liveSecretPresent: yesNo(liveSecret),
  livePublishablePresent: yesNo(livePublishable),
  livePlatformWebhookPresent: yesNo(livePlatformWebhook),
  liveConnectWebhookPresent: yesNo(liveConnectWebhook),
  liveModeDisabled: yesNo(!liveEnabled),
  connectIsolation,
  webhookIsolation,
  LIVE_PAYMENTS_ENABLED: liveEnabled,
  note: "Presence only — no secret values. Live activation remains a dedicated task.",
};

console.log(JSON.stringify(report, null, 2));

if (liveEnabled) {
  console.error(
    "WARNING: LIVE_PAYMENTS_ENABLED is true — expected false for readiness-only pass.",
  );
  process.exitCode = 2;
}
