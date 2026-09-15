/**
 * Global Payouts thin-event webhook signature verification.
 * Uses Stripe SDK parseThinEvent (official thin-event API; raw body + Stripe-Signature).
 * No secrets logged. No Prisma / money side effects.
 *
 * Note: LIVE_PAYMENTS_ENABLED read mirrors `@/lib/payments/flags` (same envBool rules)
 * so this module stays importable from offline Node unit tests without path aliases.
 */

import Stripe from "stripe";

export type StripeMode = "TEST" | "LIVE";

function envBool(name: string, defaultValue = false): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isLivePaymentsEnabled(): boolean {
  return envBool("LIVE_PAYMENTS_ENABLED", false);
}

export const GP_EVENT_DESTINATION_PING = "v2.core.event_destination.ping";

/** Strip env paste artifacts (quotes / whitespace). Never log the value. */
export function normalizeWebhookSecret(raw: string): string {
  let s = String(raw || "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = normalizeWebhookSecret(v);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function envRaw(name: string): string {
  return process.env[name] || "";
}

/** Mode-scoped GP webhook secrets (rotation-safe). */
export function getGlobalPayoutsWebhookSecrets(mode: StripeMode): string[] {
  if (mode === "LIVE") {
    return uniqueNonEmpty([
      envRaw("STRIPE_GP_WEBHOOK_SECRET_LIVE"),
      envRaw("STRIPE_GP_WEBHOOK_SECRET_LIVE_2"),
      envRaw("STRIPE_GP_WEBHOOK_SECRET"),
    ]);
  }
  return uniqueNonEmpty([
    envRaw("STRIPE_GP_WEBHOOK_SECRET_TEST"),
    envRaw("STRIPE_GP_WEBHOOK_SECRET_TEST_2"),
    envRaw("STRIPE_GP_WEBHOOK_SECRET"),
  ]);
}

export function getGlobalPayoutsWebhookSecret(mode: StripeMode): string {
  return getGlobalPayoutsWebhookSecrets(mode)[0] || "";
}

export function isGlobalPayoutsEventDestinationPing(eventType: string): boolean {
  return String(eventType || "").trim() === GP_EVENT_DESTINATION_PING;
}

export type VerifiedGpThinEvent = {
  thinEvent: Stripe.ThinEvent;
  verifiedMode: StripeMode;
};

export class GpWebhookVerifyError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "GpWebhookVerifyError";
    this.status = status;
    this.code = code;
  }
}

function modesForVerification(): StripeMode[] {
  // Always attempt TEST (Sandbox / TEST destinations). Include LIVE secrets when
  // Live is enabled or a LIVE GP secret is present (verify then mode-gate).
  const modes: StripeMode[] = ["TEST"];
  if (
    isLivePaymentsEnabled() ||
    getGlobalPayoutsWebhookSecrets("LIVE").length > 0
  ) {
    modes.push("LIVE");
  }
  return modes;
}

/** Minimal Stripe client — parseThinEvent is local crypto only. */
function stripeForVerify(): Stripe {
  return new Stripe("sk_test_webhook_verify_only", {
    apiVersion: "2025-08-27.basil",
  });
}

/**
 * Verify thin-event webhook using the exact raw body + Stripe-Signature.
 * Prefer parseThinEvent (SDK thin-event entrypoint). Do not JSON.parse/re-serialize first.
 */
export function verifyGlobalPayoutsThinEvent(
  rawBody: string | Buffer,
  signatureHeader: string,
): VerifiedGpThinEvent {
  if (!signatureHeader || !String(signatureHeader).trim()) {
    throw new GpWebhookVerifyError(
      "Invalid signature",
      400,
      "WEBHOOK_SIG_MISSING",
    );
  }

  const modes = modesForVerification();
  const anySecrets = modes.some((m) => getGlobalPayoutsWebhookSecrets(m).length > 0);
  if (!anySecrets) {
    throw new GpWebhookVerifyError(
      "Webhook secret not configured",
      503,
      "WEBHOOK_SECRET_MISSING",
    );
  }

  const stripe = stripeForVerify();
  let lastErr: unknown;

  for (const mode of modes) {
    for (const secret of getGlobalPayoutsWebhookSecrets(mode)) {
      try {
        // Official thin-event API (delegates to constructEvent crypto in stripe@18).
        const thinEvent = stripe.parseThinEvent(
          rawBody,
          signatureHeader,
          secret,
        );
        return { thinEvent, verifiedMode: mode };
      } catch (err) {
        lastErr = err;
      }
    }
  }

  void lastErr;
  throw new GpWebhookVerifyError(
    "Invalid signature",
    400,
    "WEBHOOK_SIG_INVALID",
  );
}
