/**
 * Temporary Preview-only Global Payouts runtime diagnostic helpers.
 * Read-only Stripe checks. Never logs or returns complete secrets.
 * REMOVE after one Preview validation.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import {
  getStripe,
  getStripePublishableKey,
} from "@/lib/payments/stripe/client";
import {
  getGlobalPayoutsFinancialAccountId,
  gpFetch,
  hasGlobalPayoutsRestrictedKey,
} from "@/lib/payments/payout-rail/gp-client";
import { getGlobalPayoutsWebhookSecret } from "@/lib/payments/payout-rail/webhook-verify";
import { probeFinancialAccountConfigured } from "@/lib/payments/payout-rail/fa-funding";

/** SHA-256 hex of the one-time auth token (token itself is never committed). */
export const GP_PREVIEW_RUNTIME_DIAG_AUTH_SHA256 =
  "d28fa0643c4d64ec2c9e32e420b915aa2f5d5b8babf04628f2011a2bca9245da";

export const GP_PREVIEW_RUNTIME_DIAG_HEADER = "x-gp-preview-runtime-diag-auth";

function trimEnv(name: string): string {
  return (process.env[name] || "").trim();
}

function envFlagFalse(name: string): boolean {
  const raw = trimEnv(name).toLowerCase();
  return raw === "false" || raw === "0" || raw === "";
}

export function isGpPreviewRuntimeDiagGateOpen(env: NodeJS.ProcessEnv = process.env): {
  open: boolean;
  reason?: string;
} {
  if (String(env.VERCEL_ENV || "").trim() !== "preview") {
    return { open: false, reason: "not_preview" };
  }
  if (String(env.VERCEL_GIT_COMMIT_REF || "").trim() !== "global-payouts-pilot") {
    return { open: false, reason: "wrong_branch" };
  }
  const initiation = String(env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED || "")
    .trim()
    .toLowerCase();
  if (initiation === "true" || initiation === "1" || initiation === "yes" || initiation === "on") {
    return { open: false, reason: "initiation_enabled" };
  }
  return { open: true };
}

export function verifyGpPreviewRuntimeDiagAuth(
  headerValue: string | null | undefined,
  expectedSha256Hex: string = GP_PREVIEW_RUNTIME_DIAG_AUTH_SHA256,
): boolean {
  const provided = String(headerValue || "").trim();
  if (!provided || !expectedSha256Hex || expectedSha256Hex.length !== 64) {
    return false;
  }
  const got = createHash("sha256").update(provided, "utf8").digest();
  const exp = Buffer.from(expectedSha256Hex, "hex");
  if (exp.length !== got.length) return false;
  return timingSafeEqual(got, exp);
}

function safePrefix(
  value: string,
  candidates: string[],
): string | null {
  const v = String(value || "").trim();
  for (const p of candidates) {
    if (v.startsWith(p)) return p;
  }
  return null;
}

function idPrefix(id: string, n = 12): string | null {
  const s = String(id || "").trim();
  if (!s) return null;
  return s.slice(0, Math.min(n, s.length));
}

export type GpPreviewRuntimeDiagResult = {
  ok: boolean;
  deployment: {
    vercelEnv: string;
    gitRef: string;
    isPreviewPilot: boolean;
  };
  checks: {
    STRIPE_SECRET_KEY_TEST: {
      defined: boolean;
      prefix: string | null;
      prefix_ok: boolean;
      auth_ok: boolean;
      livemode_false: boolean;
      account_id_prefix: string | null;
    };
    STRIPE_GP_RESTRICTED_KEY_TEST: {
      defined: boolean;
      prefix: string | null;
      prefix_ok: boolean;
      auth_ok: boolean;
    };
    STRIPE_GP_FINANCIAL_ACCOUNT_ID_TEST: {
      defined: boolean;
      prefix: string | null;
      prefix_ok: boolean;
      retrieve_ok: boolean;
      livemode_false: boolean;
      fa_id_prefix: string | null;
    };
    same_sandbox: boolean;
    STRIPE_GP_WEBHOOK_SECRET_TEST: {
      defined: boolean;
      prefix: string | null;
      prefix_ok: boolean;
      local_sig_self_test_ok: boolean;
    };
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST: {
      defined: boolean;
      prefix: string | null;
      prefix_ok: boolean;
    };
    GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED: {
      is_false: boolean;
      value_shape: string;
    };
  };
  mutations: {
    stripe_objects_created: number;
    db_writes: number;
  };
};

/**
 * Read-only Sandbox validation. No Stripe/DB mutations.
 */
export async function runGpPreviewRuntimeDiag(): Promise<GpPreviewRuntimeDiagResult> {
  const skRaw = trimEnv("STRIPE_SECRET_KEY_TEST");
  const rkRaw = trimEnv("STRIPE_GP_RESTRICTED_KEY_TEST");
  const faRaw = trimEnv("STRIPE_GP_FINANCIAL_ACCOUNT_ID_TEST");
  const whRaw = trimEnv("STRIPE_GP_WEBHOOK_SECRET_TEST") || getGlobalPayoutsWebhookSecret("TEST");
  let pkRaw = "";
  try {
    pkRaw = getStripePublishableKey("TEST");
  } catch {
    pkRaw = trimEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST");
  }

  const skPrefix = safePrefix(skRaw, ["sk_test_", "sk_live_"]);
  const rkPrefix = safePrefix(rkRaw, ["rk_test_", "rk_live_", "sk_test_", "sk_live_"]);
  const faPrefix = safePrefix(faRaw, ["fa_test_", "fa_"]);
  const whPrefix = safePrefix(whRaw, ["whsec_"]);
  const pkPrefix = safePrefix(pkRaw, ["pk_test_", "pk_live_"]);

  let skAuthOk = false;
  let skLivemodeFalse = false;
  let accountIdPrefix: string | null = null;
  if (skPrefix === "sk_test_") {
    try {
      const stripe = getStripe("TEST");
      const bal = await stripe.balance.retrieve();
      skAuthOk = true;
      skLivemodeFalse = bal.livemode === false;
      const acct = await stripe.accounts.retrieve();
      accountIdPrefix = idPrefix(String(acct.id || ""), 12);
      if (acct.livemode === true) skLivemodeFalse = false;
    } catch {
      skAuthOk = false;
    }
  }

  let rkAuthOk = false;
  let faRetrieveOk = false;
  let faLivemodeFalse = false;
  let faIdPrefix: string | null = faPrefix ? idPrefix(faRaw, 12) : null;
  let sameSandbox = false;

  const probe = await probeFinancialAccountConfigured("TEST");
  if (hasGlobalPayoutsRestrictedKey("TEST") && rkPrefix === "rk_test_") {
    // Authorized read via existing GP client (GET FA).
    const faId = getGlobalPayoutsFinancialAccountId("TEST");
    if (faId && faId.startsWith("fa_test_")) {
      const res = await gpFetch({
        mode: "TEST",
        method: "GET",
        path: `/v2/money_management/financial_accounts/${encodeURIComponent(faId)}`,
      });
      rkAuthOk = res.ok;
      faRetrieveOk = res.ok && probe.configured;
      const livemode = res.body?.livemode;
      faLivemodeFalse = livemode === false;
      if (typeof res.body?.id === "string") {
        faIdPrefix = idPrefix(res.body.id, 12);
      }
      // Same Sandbox: TEST sk auth + FA retrieve livemode false + fa_test_ + rk_test_
      sameSandbox =
        skAuthOk &&
        skLivemodeFalse &&
        rkAuthOk &&
        faRetrieveOk &&
        faLivemodeFalse &&
        faPrefix === "fa_test_";
    }
  }

  let whSelfTestOk = false;
  if (whPrefix === "whsec_") {
    try {
      const stripe = new Stripe("sk_test_webhook_selftest_only", {
        apiVersion: "2025-08-27.basil",
      });
      const payload = JSON.stringify({
        id: "evt_gp_preview_runtime_diag_selftest",
        object: "event",
        type: "v2.core.event_destination.ping",
        livemode: false,
      });
      const header = stripe.webhooks.generateTestHeaderString({
        payload,
        secret: whRaw,
      });
      stripe.webhooks.constructEvent(payload, header, whRaw);
      whSelfTestOk = true;
    } catch {
      whSelfTestOk = false;
    }
  }

  const initiationRaw = trimEnv("GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED");
  const initiationFalse = envFlagFalse("GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED") && initiationRaw.toLowerCase() !== "true";
  // Explicit: empty defaults to false; only "false"/"0"/"" count as false shape for report
  const initiationShape =
    initiationRaw === ""
      ? "empty_default_false"
      : ["false", "0", "true", "1"].includes(initiationRaw.toLowerCase())
        ? initiationRaw.toLowerCase()
        : "other";

  const checks = {
    STRIPE_SECRET_KEY_TEST: {
      defined: Boolean(skRaw),
      prefix: skPrefix,
      prefix_ok: skPrefix === "sk_test_",
      auth_ok: skAuthOk,
      livemode_false: skLivemodeFalse,
      account_id_prefix: accountIdPrefix,
    },
    STRIPE_GP_RESTRICTED_KEY_TEST: {
      defined: Boolean(rkRaw),
      prefix: rkPrefix,
      prefix_ok: rkPrefix === "rk_test_",
      auth_ok: rkAuthOk,
    },
    STRIPE_GP_FINANCIAL_ACCOUNT_ID_TEST: {
      defined: Boolean(faRaw),
      prefix: faPrefix === "fa_" ? (faRaw.startsWith("fa_test_") ? "fa_test_" : faPrefix) : faPrefix,
      prefix_ok: faRaw.startsWith("fa_test_"),
      retrieve_ok: faRetrieveOk,
      livemode_false: faLivemodeFalse,
      fa_id_prefix: faIdPrefix,
    },
    same_sandbox: sameSandbox,
    STRIPE_GP_WEBHOOK_SECRET_TEST: {
      defined: Boolean(whRaw),
      prefix: whPrefix,
      prefix_ok: whPrefix === "whsec_",
      local_sig_self_test_ok: whSelfTestOk,
    },
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST: {
      defined: Boolean(pkRaw),
      prefix: pkPrefix,
      prefix_ok: pkPrefix === "pk_test_",
    },
    GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED: {
      is_false: initiationFalse || initiationRaw.toLowerCase() === "false" || initiationRaw === "",
      value_shape: initiationShape,
    },
  };

  // Tighten initiation: must be explicitly false for VALID gate preference
  checks.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED.is_false =
    initiationRaw.toLowerCase() === "false" || initiationRaw === "0";

  const ok =
    checks.STRIPE_SECRET_KEY_TEST.prefix_ok &&
    checks.STRIPE_SECRET_KEY_TEST.auth_ok &&
    checks.STRIPE_SECRET_KEY_TEST.livemode_false &&
    checks.STRIPE_GP_RESTRICTED_KEY_TEST.prefix_ok &&
    checks.STRIPE_GP_RESTRICTED_KEY_TEST.auth_ok &&
    checks.STRIPE_GP_FINANCIAL_ACCOUNT_ID_TEST.prefix_ok &&
    checks.STRIPE_GP_FINANCIAL_ACCOUNT_ID_TEST.retrieve_ok &&
    checks.STRIPE_GP_FINANCIAL_ACCOUNT_ID_TEST.livemode_false &&
    checks.same_sandbox &&
    checks.STRIPE_GP_WEBHOOK_SECRET_TEST.prefix_ok &&
    checks.STRIPE_GP_WEBHOOK_SECRET_TEST.local_sig_self_test_ok &&
    checks.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST.prefix_ok &&
    checks.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED.is_false;

  return {
    ok,
    deployment: {
      vercelEnv: String(process.env.VERCEL_ENV || ""),
      gitRef: String(process.env.VERCEL_GIT_COMMIT_REF || ""),
      isPreviewPilot:
        process.env.VERCEL_ENV === "preview" &&
        process.env.VERCEL_GIT_COMMIT_REF === "global-payouts-pilot",
    },
    checks,
    mutations: { stripe_objects_created: 0, db_writes: 0 },
  };
}
