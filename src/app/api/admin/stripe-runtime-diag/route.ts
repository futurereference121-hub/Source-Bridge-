import { randomBytes } from "crypto";
import { requireAdmin } from "@/lib/auth";
import {
  getStripe,
  getStripePublishableKey,
  getStripeSecretKey,
  getStripeWebhookSecret,
} from "@/lib/payments/stripe/client";
import { getStripeMode, paymentFlagsSnapshot } from "@/lib/payments/flags";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * TEMPORARY admin-only Stripe runtime diagnostic.
 * Returns only safe PASS/FAIL fields — never secret values, full account ids, or webhooks secrets.
 * Remove this route after Production verification.
 *
 * Does NOT enable PAYMENTS_ENABLED. Bypasses isStripeConfigured() payment-flag gate so
 * credentials can be verified while feature flags remain off.
 */
function redactAccountId(id: string | null | undefined): string | null {
  if (!id || typeof id !== "string") return null;
  if (id.length < 8) return "acct_****";
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function keyMeta(raw: string) {
  const v = (raw || "").trim();
  return {
    present: Boolean(v),
    runtimeLength: v.length,
    prefix:
      v.startsWith("sk_test_")
        ? "sk_test_"
        : v.startsWith("sk_live_")
          ? "sk_live_"
          : v.startsWith("pk_test_")
            ? "pk_test_"
            : v.startsWith("pk_live_")
              ? "pk_live_"
              : v.startsWith("whsec_")
                ? "whsec_"
                : v
                  ? "OTHER"
                  : "EMPTY",
  };
}

export async function POST(req: Request) {
  const requestId = randomBytes(6).toString("hex");
  try {
    await requireAdmin();

    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
    };
    const action = body.action || "whoami";

    const secretResolved = (() => {
      try {
        return getStripeSecretKey();
      } catch (err) {
        return "";
      }
    })();
    const pub = getStripePublishableKey();
    const wh = getStripeWebhookSecret();

    const env = {
      STRIPE_SECRET_KEY_TEST_loaded: Boolean(process.env.STRIPE_SECRET_KEY_TEST?.trim()),
      STRIPE_SECRET_KEY_loaded: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST_loaded: Boolean(
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST?.trim(),
      ),
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_loaded: Boolean(
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim(),
      ),
      STRIPE_WEBHOOK_SECRET_loaded: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
      STRIPE_WEBHOOK_SECRET_TEST_loaded: Boolean(
        process.env.STRIPE_WEBHOOK_SECRET_TEST?.trim(),
      ),
      secretResolution: {
        preferredSource: process.env.STRIPE_SECRET_KEY_TEST?.trim()
          ? "STRIPE_SECRET_KEY_TEST"
          : process.env.STRIPE_SECRET_KEY?.trim()
            ? "STRIPE_SECRET_KEY"
            : "NONE",
        ...keyMeta(secretResolved),
      },
      publishableResolution: {
        preferredSource: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST?.trim()
          ? "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST"
          : process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim()
            ? "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
            : "NONE",
        ...keyMeta(pub),
      },
      webhookResolution: {
        preferredSource: process.env.STRIPE_WEBHOOK_SECRET_TEST?.trim()
          ? "STRIPE_WEBHOOK_SECRET_TEST"
          : process.env.STRIPE_WEBHOOK_SECRET?.trim()
            ? "STRIPE_WEBHOOK_SECRET"
            : "NONE",
        ...keyMeta(wh),
      },
      note: "runtime lengths from process.env in Production — not CLI redaction",
    };

    if (secretResolved && !secretResolved.startsWith("sk_test_")) {
      return Response.json({
        requestId,
        authenticated: "FAIL",
        httpStatus: null,
        mode: "LIVE_OR_INVALID",
        reason: "LIVE_KEY_REFUSED",
        env,
        flags: paymentFlagsSnapshot(),
      });
    }

    let stripe;
    try {
      stripe = getStripe();
    } catch (err) {
      return Response.json({
        requestId,
        authenticated: "FAIL",
        httpStatus: null,
        mode: getStripeMode(),
        reason:
          err instanceof Error ? err.message.slice(0, 160) : "STRIPE_CLIENT_INIT_FAILED",
        env,
        flags: paymentFlagsSnapshot(),
      });
    }

    // Platform account (whoami equivalent)
    let httpStatus: number | null = null;
    let mode: "TEST" | "LIVE" | "UNKNOWN" = "UNKNOWN";
    let platform: {
      idRedacted: string | null;
      country: string | null;
      type: string | null;
      chargesEnabled: boolean | null;
      payoutsEnabled: boolean | null;
      detailsSubmitted: boolean | null;
      businessType: string | null;
      controller: unknown;
      connectCapable: boolean | null;
    } = {
      idRedacted: null,
      country: null,
      type: null,
      chargesEnabled: null,
      payoutsEnabled: null,
      detailsSubmitted: null,
      businessType: null,
      controller: null,
      connectCapable: null,
    };
    let safeError: string | null = null;
    let authPass = false;

    try {
      const account = await stripe.accounts.retrieve();
      httpStatus = 200;
      authPass = true;
      const livemode = Boolean((account as { livemode?: boolean }).livemode);
      mode = livemode ? "LIVE" : "TEST";
      if (mode === "LIVE") {
        return Response.json({
          requestId,
          authenticated: "FAIL",
          httpStatus,
          mode: "LIVE",
          reason: "LIVE_MODE_DETECTED — verification aborts",
          platform: { idRedacted: redactAccountId(account.id) },
          env,
          flags: paymentFlagsSnapshot(),
        });
      }
      platform = {
        idRedacted: redactAccountId(account.id),
        country: account.country || null,
        type: account.type || null,
        chargesEnabled: Boolean(account.charges_enabled),
        payoutsEnabled: Boolean(account.payouts_enabled),
        detailsSubmitted: Boolean(account.details_submitted),
        businessType: account.business_type || null,
        controller: account.controller
          ? {
              type: (account.controller as { type?: string }).type || null,
              isController: Boolean(
                (account.controller as { is_controller?: boolean }).is_controller,
              ),
            }
          : null,
        // Ability to create Connect accounts is proven by connect step; presence of type/platform is soft signal.
        connectCapable: true,
      };
    } catch (err) {
      const status = (err as { statusCode?: number; status?: number }).statusCode
        || (err as { status?: number }).status
        || null;
      httpStatus = status;
      safeError =
        err instanceof Error ? err.message.slice(0, 200) : "accounts_retrieve_failed";
      // Infer mode from secret prefix if auth failed
      mode = secretResolved.startsWith("sk_test_") ? "TEST" : "UNKNOWN";
    }

    let connect: Record<string, unknown> | null = null;
    if (authPass && action === "connect") {
      const returnUrl =
        "https://www.sourcebridge.app/profile/settings/payments?connect=return";
      const refreshUrl =
        "https://www.sourcebridge.app/profile/settings/payments?connect=refresh";
      try {
        // Same parameters as createConnectOnboardingLink in connect.ts (no DB, no PAYMENTS flag).
        const account = await stripe.accounts.create({
          email: `stripe-diag-${requestId}@sourcebridge.invalid`,
          controller: {
            stripe_dashboard: { type: "express" },
            fees: { payer: "application" },
            losses: { payments: "application" },
            requirement_collection: "stripe",
          },
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: {
            sourceBridgeDiag: "true",
            sourceBridgeRequestId: requestId,
          },
        });

        const caps = (account.capabilities || {}) as Record<string, string | undefined>;
        const link = await stripe.accountLinks.create({
          account: account.id,
          refresh_url: refreshUrl,
          return_url: returnUrl,
          type: "account_onboarding",
        });

        let deleted = false;
        try {
          await stripe.accounts.del(account.id);
          deleted = true;
        } catch {
          deleted = false;
        }

        connect = {
          create: "PASS",
          accountIdRedacted: redactAccountId(account.id),
          type: account.type,
          capabilitiesRequested: {
            card_payments: caps.card_payments || "requested",
            transfers: caps.transfers || "requested",
          },
          accountLink: link.url ? "PASS" : "FAIL",
          accountLinkHost: (() => {
            try {
              return new URL(link.url).host;
            } catch {
              return null;
            }
          })(),
          returnUrl,
          refreshUrl,
          deletedAfterTest: deleted,
        };
      } catch (err) {
        const status = (err as { statusCode?: number; status?: number }).statusCode
          || (err as { status?: number }).status
          || null;
        connect = {
          create: "FAIL",
          accountLink: "FAIL",
          httpStatus: status,
          safeError:
            err instanceof Error ? err.message.slice(0, 200) : "connect_create_failed",
        };
      }
    }

    return Response.json({
      requestId,
      authenticated: authPass ? "PASS" : "FAIL",
      httpStatus,
      mode,
      platform,
      safeError,
      connect,
      env,
      flags: paymentFlagsSnapshot(),
      chargeModel: "SEPARATE_CHARGES_AND_TRANSFERS",
    });
  } catch (error) {
    const status = (error as { status?: number }).status || 500;
    return jsonError(
      status === 401
        ? "Sign in required"
        : status === 403
          ? "Admin only"
          : "Diagnostic failed",
      status,
      { requestId },
    );
  }
}
