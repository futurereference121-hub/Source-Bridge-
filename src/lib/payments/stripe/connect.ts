import { prisma } from "@/lib/db";
import { getStripeMode } from "@/lib/payments/flags";
import {
  getStripe,
  getStripeSecretKey,
  hasStripeTestSecretKey,
  isStripeConfigured,
} from "@/lib/payments/stripe/client";
import { recordAuditEvent } from "@/lib/payments/ledger";

/**
 * Stripe Accounts v2 API version required for new Connect platforms that reject
 * Accounts v1 `type: express` / controller-based creates.
 * See https://docs.stripe.com/api/v2/core/accounts
 */
const STRIPE_ACCOUNTS_V2_VERSION = "2026-07-29.dahlia";

export type CreatedConnectAccount = {
  id: string;
  country: string;
  defaultCurrency: string;
  capabilities: Record<string, unknown>;
};

/**
 * Create a connected account equivalent to Express + card_payments + transfers
 * (Separate Charges and Transfers ready), via Accounts v2.
 * Required on newer platforms where POST /v1/accounts is refused.
 */
export async function createExpressStyleConnectedAccount(opts: {
  email: string;
  userId: string;
  country?: string;
  currency?: string;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
}): Promise<CreatedConnectAccount> {
  const key = getStripeSecretKey();
  if (!key) {
    throw Object.assign(new Error("Stripe is not configured (TEST keys required)"), {
      status: 503,
      code: "STRIPE_NOT_CONFIGURED",
    });
  }
  if (!key.startsWith("sk_test_")) {
    throw Object.assign(
      new Error("Only Stripe TEST secret keys are accepted while LIVE_PAYMENTS_ENABLED=false"),
      { status: 503, code: "STRIPE_LIVE_KEY_REFUSED" },
    );
  }

  const country = (opts.country || "GB").toLowerCase();
  const currency = (opts.currency || (country === "gb" ? "gbp" : "usd")).toLowerCase();
  const body = {
    contact_email: opts.email,
    display_name: (opts.email.split("@")[0] || "seller").slice(0, 80),
    dashboard: "express",
    identity: { country },
    configuration: {
      merchant: {
        capabilities: {
          card_payments: { requested: true },
        },
      },
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { requested: true },
          },
        },
      },
    },
    defaults: {
      currency,
      responsibilities: {
        // Required when dashboard=express (mirrors Express / SCT platform liability).
        fees_collector: "application",
        losses_collector: "application",
      },
    },
    metadata: {
      sourceBridgeUserId: opts.userId,
      ...(opts.metadata || {}),
    },
    include: [
      "configuration.merchant",
      "configuration.recipient",
      "identity",
      "defaults",
      "requirements",
    ],
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Stripe-Version": STRIPE_ACCOUNTS_V2_VERSION,
    "Content-Type": "application/json",
  };
  if (opts.idempotencyKey) {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }

  const res = await fetch("https://api.stripe.com/v2/core/accounts", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    identity?: { country?: string };
    defaults?: { currency?: string };
    configuration?: {
      merchant?: { capabilities?: Record<string, unknown> };
      recipient?: { capabilities?: Record<string, unknown> };
    };
    error?: { message?: string; code?: string };
    message?: string;
  };

  if (!res.ok || !json.id) {
    const msg =
      json.error?.message ||
      json.message ||
      `Accounts v2 create failed (HTTP ${res.status})`;
    throw Object.assign(new Error(msg.slice(0, 300)), {
      status: res.status >= 400 && res.status < 500 ? res.status : 502,
      statusCode: res.status,
      code: "STRIPE_CONNECT_V2_CREATE_FAILED",
    });
  }

  return {
    id: json.id,
    country: (json.identity?.country || country || "").toUpperCase(),
    defaultCurrency: (json.defaults?.currency || currency || "gbp").toLowerCase(),
    capabilities: {
      card_payments: json.configuration?.merchant?.capabilities?.card_payments ?? "requested",
      stripe_transfers:
        (
          json.configuration?.recipient?.capabilities as
            | { stripe_balance?: { stripe_transfers?: unknown } }
            | undefined
        )?.stripe_balance?.stripe_transfers ?? "requested",
    },
  };
}

export type ConnectStatus = {
  configured: boolean;
  stripeMode: string;
  hasAccount: boolean;
  stripeAccountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  capabilities: Record<string, unknown>;
  requirements: Record<string, unknown>;
  country: string;
  disabledReason: string;
  canReceiveProtectedPayments: boolean;
  lastSyncedAt: string | null;
};

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function getConnectStatus(userId: string): Promise<ConnectStatus> {
  const row = await prisma.stripeConnectAccount.findUnique({
    where: { userId },
  });
  const configured = isStripeConfigured();
  if (!row) {
    return {
      configured,
      stripeMode: getStripeMode(),
      hasAccount: false,
      stripeAccountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      capabilities: {},
      requirements: {},
      country: "",
      disabledReason: "",
      canReceiveProtectedPayments: false,
      lastSyncedAt: null,
    };
  }
  return {
    configured,
    stripeMode: row.stripeMode,
    hasAccount: true,
    stripeAccountId: row.stripeAccountId,
    chargesEnabled: row.chargesEnabled,
    payoutsEnabled: row.payoutsEnabled,
    detailsSubmitted: row.detailsSubmitted,
    capabilities: parseJsonObject(row.capabilitiesJson),
    requirements: parseJsonObject(row.requirementsJson),
    country: row.country,
    disabledReason: row.disabledReason,
    canReceiveProtectedPayments: row.chargesEnabled && row.payoutsEnabled,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  };
}

/**
 * Sync local Connect row from Stripe.
 * @param allowWhenPaymentsDisabled — webhook path: status sync only, no money movement.
 */
export async function syncConnectAccount(
  userId: string,
  opts?: { allowWhenPaymentsDisabled?: boolean; eventId?: string; eventType?: string },
) {
  const apiReady = opts?.allowWhenPaymentsDisabled
    ? hasStripeTestSecretKey()
    : isStripeConfigured();
  if (!apiReady) {
    throw Object.assign(new Error("Payments are not enabled or Stripe is not configured"), {
      status: 503,
      code: "STRIPE_NOT_CONFIGURED",
    });
  }
  const existing = await prisma.stripeConnectAccount.findUnique({
    where: { userId },
  });
  if (!existing) {
    throw Object.assign(new Error("No Connect account linked"), {
      status: 404,
      code: "CONNECT_NOT_FOUND",
    });
  }
  return applyStripeAccountSnapshot(existing.userId, existing.stripeAccountId, existing, opts);
}

/**
 * Webhook helper: resolve seller by Stripe account id and refresh non-financial status.
 * Safe while PAYMENTS_ENABLED is false (read + local status only).
 */
export async function syncConnectAccountByStripeId(
  stripeAccountId: string,
  opts?: { allowWhenPaymentsDisabled?: boolean; eventId?: string; eventType?: string },
): Promise<boolean> {
  const row = await prisma.stripeConnectAccount.findUnique({
    where: { stripeAccountId },
  });
  if (!row) return false;
  await syncConnectAccount(row.userId, {
    allowWhenPaymentsDisabled: opts?.allowWhenPaymentsDisabled ?? true,
    eventId: opts?.eventId,
    eventType: opts?.eventType,
  });
  return true;
}

async function applyStripeAccountSnapshot(
  userId: string,
  stripeAccountId: string,
  existing: {
    country: string;
    defaultCurrency: string;
    email: string;
  },
  opts?: { eventId?: string; eventType?: string },
) {
  const stripe = getStripe();
  // v1 retrieve is compatible with Accounts v2 connected account ids and
  // exposes charges_enabled / payouts_enabled / requirements for local status.
  const account = await stripe.accounts.retrieve(stripeAccountId);
  const caps = (account.capabilities || {}) as Record<string, unknown>;
  const req = {
    currently_due: account.requirements?.currently_due || [],
    past_due: account.requirements?.past_due || [],
    eventually_due: account.requirements?.eventually_due || [],
    disabled_reason: account.requirements?.disabled_reason || null,
  };
  const updated = await prisma.stripeConnectAccount.update({
    where: { userId },
    data: {
      chargesEnabled: Boolean(account.charges_enabled),
      payoutsEnabled: Boolean(account.payouts_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
      capabilitiesJson: JSON.stringify(caps),
      requirementsJson: JSON.stringify(req),
      country: account.country || existing.country,
      defaultCurrency: account.default_currency || existing.defaultCurrency,
      email: typeof account.email === "string" ? account.email : existing.email,
      disabledReason: account.requirements?.disabled_reason || "",
      lastSyncedAt: new Date(),
      stripeMode: getStripeMode(),
    },
  });
  await recordAuditEvent({
    actorUserId: userId,
    action: "CONNECT_ACCOUNT_SYNCED",
    meta: {
      stripeAccountId: updated.stripeAccountId,
      eventId: opts?.eventId || null,
      eventType: opts?.eventType || null,
      chargesEnabled: updated.chargesEnabled,
      payoutsEnabled: updated.payoutsEnabled,
      detailsSubmitted: updated.detailsSubmitted,
      disabledReason: updated.disabledReason || null,
    },
  });
  return updated;
}

export async function createConnectOnboardingLink(opts: {
  userId: string;
  email: string;
  returnUrl: string;
  refreshUrl: string;
}) {
  if (!isStripeConfigured()) {
    throw Object.assign(new Error("Payments are not enabled or Stripe is not configured"), {
      status: 503,
      code: "STRIPE_NOT_CONFIGURED",
    });
  }
  const stripe = getStripe();
  let row = await prisma.stripeConnectAccount.findUnique({
    where: { userId: opts.userId },
  });
  if (!row) {
    // New Connect platforms reject Accounts v1 type=express; use Accounts v2.
    const account = await createExpressStyleConnectedAccount({
      email: opts.email,
      userId: opts.userId,
      idempotencyKey: `connect_create_${opts.userId}_${getStripeMode()}`,
    });
    row = await prisma.stripeConnectAccount.create({
      data: {
        userId: opts.userId,
        stripeAccountId: account.id,
        stripeMode: getStripeMode(),
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        country: account.country || "",
        defaultCurrency: account.defaultCurrency || "gbp",
        email: opts.email,
        capabilitiesJson: JSON.stringify(account.capabilities),
        lastSyncedAt: new Date(),
      },
    });
    await recordAuditEvent({
      actorUserId: opts.userId,
      action: "CONNECT_ACCOUNT_CREATED",
      meta: { stripeAccountId: account.id, api: "v2" },
    });
  }
  const link = await stripe.accountLinks.create({
    account: row.stripeAccountId,
    refresh_url: opts.refreshUrl,
    return_url: opts.returnUrl,
    type: "account_onboarding",
  });
  return { url: link.url, stripeAccountId: row.stripeAccountId };
}

export async function createConnectLoginLink(userId: string) {
  if (!isStripeConfigured()) {
    throw Object.assign(new Error("Payments are not enabled or Stripe is not configured"), {
      status: 503,
      code: "STRIPE_NOT_CONFIGURED",
    });
  }
  const row = await prisma.stripeConnectAccount.findUnique({
    where: { userId },
  });
  if (!row) {
    throw Object.assign(new Error("No Connect account linked"), {
      status: 404,
      code: "CONNECT_NOT_FOUND",
    });
  }
  const stripe = getStripe();
  const link = await stripe.accounts.createLoginLink(row.stripeAccountId);
  return { url: link.url };
}
