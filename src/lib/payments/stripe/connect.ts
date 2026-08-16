import { prisma } from "@/lib/db";
import {
  getStripeMode,
  isConnectOnboardingEnabled,
} from "@/lib/payments/flags";
import {
  getStripe,
  getStripeSecretKey,
  hasStripeTestSecretKey,
  isConnectOnboardingApiReady,
  isStripeConfigured,
} from "@/lib/payments/stripe/client";
import { recordAuditEvent } from "@/lib/payments/ledger";

function assertConnectOnboardingApiReady(): void {
  if (isConnectOnboardingApiReady()) return;
  if (!hasStripeTestSecretKey()) {
    throw Object.assign(
      new Error("Stripe test configuration is unavailable."),
      { status: 503, code: "STRIPE_TEST_NOT_CONFIGURED" },
    );
  }
  if (!isConnectOnboardingEnabled()) {
    throw Object.assign(
      new Error("Payout setup is not currently available."),
      { status: 503, code: "CONNECT_ONBOARDING_DISABLED" },
    );
  }
  throw Object.assign(
    new Error("Payout setup is not currently available."),
    { status: 503, code: "CONNECT_ONBOARDING_UNAVAILABLE" },
  );
}

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
  /** @deprecated prefer stripeTestConfigured + onboardingReady */
  configured: boolean;
  /** Stripe sk_test_ present (independent of PAYMENTS_ENABLED). */
  stripeTestConfigured: boolean;
  /** CONNECT_ONBOARDING_ENABLED + TEST keys + TEST mode. */
  onboardingReady: boolean;
  stripeMode: string;
  hasAccount: boolean;
  stripeAccountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  capabilities: Record<string, unknown>;
  requirements: Record<string, unknown>;
  requirementsDueCount: number;
  country: string;
  disabledReason: string;
  /** True only after Stripe reports charges + payouts enabled (not assumed from form submit). */
  canReceiveProtectedPayments: boolean;
  lastSyncedAt: string | null;
};

function requirementsDueCount(req: Record<string, unknown>): number {
  const currently = Array.isArray(req.currently_due) ? req.currently_due.length : 0;
  const past = Array.isArray(req.past_due) ? req.past_due.length : 0;
  return currently + past;
}

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

export async function getSellerConnectFundingState(sellerId: string): Promise<{
  ready: boolean;
  hasAccount: boolean;
  stripeAccountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}> {
  const row = await prisma.stripeConnectAccount.findUnique({
    where: { userId: sellerId },
    select: {
      stripeAccountId: true,
      chargesEnabled: true,
      payoutsEnabled: true,
    },
  });
  const stripeAccountId = row?.stripeAccountId || null;
  const chargesEnabled = Boolean(row?.chargesEnabled);
  const payoutsEnabled = Boolean(row?.payoutsEnabled);
  return {
    ready: Boolean(stripeAccountId && chargesEnabled && payoutsEnabled),
    hasAccount: Boolean(stripeAccountId),
    stripeAccountId,
    chargesEnabled,
    payoutsEnabled,
  };
}

export async function getConnectStatus(userId: string): Promise<ConnectStatus> {
  const row = await prisma.stripeConnectAccount.findUnique({
    where: { userId },
  });
  const stripeTestConfigured = hasStripeTestSecretKey();
  const onboardingReady = isConnectOnboardingApiReady();
  // `configured` drives legacy clients: Connect onboarding readiness (not PAYMENTS_ENABLED).
  const configured = onboardingReady;
  if (!row) {
    return {
      configured,
      stripeTestConfigured,
      onboardingReady,
      stripeMode: getStripeMode(),
      hasAccount: false,
      stripeAccountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      capabilities: {},
      requirements: {},
      requirementsDueCount: 0,
      country: "",
      disabledReason: "",
      canReceiveProtectedPayments: false,
      lastSyncedAt: null,
    };
  }
  const requirements = parseJsonObject(row.requirementsJson);
  return {
    configured,
    stripeTestConfigured,
    onboardingReady,
    stripeMode: row.stripeMode,
    hasAccount: true,
    stripeAccountId: row.stripeAccountId,
    chargesEnabled: row.chargesEnabled,
    payoutsEnabled: row.payoutsEnabled,
    detailsSubmitted: row.detailsSubmitted,
    capabilities: parseJsonObject(row.capabilitiesJson),
    requirements,
    requirementsDueCount: requirementsDueCount(requirements),
    country: row.country,
    disabledReason: row.disabledReason,
    // Never claim ready for Protected Payments until Stripe confirms both.
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
  // Webhooks: key-only. User-facing: Connect onboarding flag (not PAYMENTS_ENABLED).
  // Money movement still uses isStripeConfigured elsewhere.
  const apiReady = opts?.allowWhenPaymentsDisabled
    ? hasStripeTestSecretKey()
    : isConnectOnboardingApiReady() || isStripeConfigured();
  if (!apiReady) {
    if (opts?.allowWhenPaymentsDisabled) {
      throw Object.assign(new Error("Stripe test configuration is unavailable."), {
        status: 503,
        code: "STRIPE_TEST_NOT_CONFIGURED",
      });
    }
    assertConnectOnboardingApiReady();
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
  assertConnectOnboardingApiReady();
  const stripe = getStripe();
  // Reuse existing local mapping — never create a second Connect account per user.
  let row = await prisma.stripeConnectAccount.findUnique({
    where: { userId: opts.userId },
  });
  if (!row) {
    // New Connect platforms reject Accounts v1 type=express; use Accounts v2.
    // Idempotency key + unique userId prevent duplicate Stripe accounts.
    const account = await createExpressStyleConnectedAccount({
      email: opts.email,
      userId: opts.userId,
      idempotencyKey: `connect_create_${opts.userId}_${getStripeMode()}`,
    });
    try {
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
    } catch (err) {
      // Race: another request created the row — reuse it (no second account row).
      const existing = await prisma.stripeConnectAccount.findUnique({
        where: { userId: opts.userId },
      });
      if (!existing) throw err;
      row = existing;
    }
    if (row.stripeAccountId === account.id) {
      await recordAuditEvent({
        actorUserId: opts.userId,
        action: "CONNECT_ACCOUNT_CREATED",
        meta: { stripeAccountId: account.id, api: "v2" },
      });
    }
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
  assertConnectOnboardingApiReady();
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
