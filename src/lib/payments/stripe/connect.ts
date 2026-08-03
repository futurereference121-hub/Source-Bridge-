import { prisma } from "@/lib/db";
import { getStripeMode } from "@/lib/payments/flags";
import { getStripe, isStripeConfigured } from "@/lib/payments/stripe/client";
import { recordAuditEvent } from "@/lib/payments/ledger";

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

export async function syncConnectAccount(userId: string) {
  if (!isStripeConfigured()) {
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
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(existing.stripeAccountId);
  const caps = (account.capabilities || {}) as Record<string, unknown>;
  const req = {
    currently_due: account.requirements?.currently_due || [],
    past_due: account.requirements?.past_due || [],
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
    meta: { stripeAccountId: updated.stripeAccountId },
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
    const account = await stripe.accounts.create(
      {
        type: "express",
        email: opts.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { sourceBridgeUserId: opts.userId },
      },
      { idempotencyKey: `connect_create_${opts.userId}_${getStripeMode()}` },
    );
    row = await prisma.stripeConnectAccount.create({
      data: {
        userId: opts.userId,
        stripeAccountId: account.id,
        stripeMode: getStripeMode(),
        chargesEnabled: Boolean(account.charges_enabled),
        payoutsEnabled: Boolean(account.payouts_enabled),
        detailsSubmitted: Boolean(account.details_submitted),
        country: account.country || "",
        defaultCurrency: account.default_currency || "usd",
        email: opts.email,
        lastSyncedAt: new Date(),
      },
    });
    await recordAuditEvent({
      actorUserId: opts.userId,
      action: "CONNECT_ACCOUNT_CREATED",
      meta: { stripeAccountId: account.id },
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
