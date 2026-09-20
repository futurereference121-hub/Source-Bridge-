/**
 * Global Payouts recipient service — isolated from Connect account create/transfer.
 * Never stores bank account numbers. Stripe-hosted collection preferred.
 */

import { prisma } from "@/lib/db";
import {
  getStripeMode,
  isGlobalPayoutsEnabled,
  normalizeStripeMode,
  type StripeMode,
} from "@/lib/payments/flags";
import {
  isGlobalPayoutsCountryAllowed,
  isGlobalPayoutsUserAllowed,
} from "@/lib/payments/payout-rail/eligibility";
import { gpErrorMessage, gpFetch, hasGlobalPayoutsRestrictedKey } from "@/lib/payments/payout-rail/gp-client";
import { isGpRecipientPayoutReady } from "@/lib/payments/payout-rail/rail-resolver";

/**
 * Stripe Global Payouts payout-method capability for a recipient country.
 * Thailand (THB) is Wire-only per Stripe GP country tables — requesting
 * `bank_accounts.local` yields hosted onboarding dead-end:
 * "features that aren't available for your account."
 * Expand this map as more GP pilot countries are enabled.
 */
export function recipientBankCapabilityForCountry(
  country: string,
): "local" | "wire" {
  const code = String(country || "").trim().toUpperCase();
  // Wire-only pilot / documented wire-only countries for cross-border GP.
  if (code === "TH") return "wire";
  return "local";
}

/**
 * Pure readiness + selection for Stripe v2 PayoutMethod list items.
 * GP PayoutMethods expose `usage_status.transfers`, not a top-level `status`.
 * Prefer non-archived bank accounts; for wire-only countries prefer wire delivery.
 */
export function pickReadyPayoutMethodId(
  methods: unknown[],
  opts?: { preferWire?: boolean },
): { id: string; ready: boolean } | null {
  const preferWire = Boolean(opts?.preferWire);
  type Cand = {
    id: string;
    ready: boolean;
    archived: boolean;
    hasWire: boolean;
    hasBank: boolean;
  };
  const cands: Cand[] = [];
  for (const raw of methods) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    const id = typeof m.id === "string" ? m.id.trim() : "";
    if (!id) continue;
    const bank =
      m.bank_account && typeof m.bank_account === "object"
        ? (m.bank_account as Record<string, unknown>)
        : null;
    const archived = Boolean(bank?.archived);
    const delivery = Array.isArray(bank?.enabled_delivery_options)
      ? (bank!.enabled_delivery_options as unknown[]).map((d) =>
          String(d || "").toLowerCase(),
        )
      : [];
    const hasWire = delivery.includes("wire");
    const usage =
      m.usage_status && typeof m.usage_status === "object"
        ? (m.usage_status as Record<string, unknown>)
        : null;
    const transfers = String(usage?.transfers || "").toLowerCase();
    const topStatus = String(m.status || "").toLowerCase();
    // Docs: usage_status.transfers === "eligible". Legacy/tolerant: top-level
    // status active|validated|ready, or empty status when usage absent.
    const ready =
      transfers === "eligible" ||
      topStatus === "active" ||
      topStatus === "validated" ||
      topStatus === "ready" ||
      (!transfers && !topStatus);
    cands.push({
      id,
      ready,
      archived,
      hasWire,
      hasBank: Boolean(bank),
    });
  }
  const usable = cands.filter((c) => c.ready && !c.archived);
  if (usable.length === 0) return null;
  if (preferWire) {
    const wire = usable.find((c) => c.hasWire) || usable.find((c) => c.hasBank);
    if (wire) return { id: wire.id, ready: true };
  }
  return { id: usable[0].id, ready: true };
}

function recipientCapabilitiesBody(country: string) {
  const method = recipientBankCapabilityForCountry(country);
  if (method === "wire") {
    return {
      bank_accounts: { wire: { requested: true } },
    };
  }
  return {
    bank_accounts: { local: { requested: true } },
  };
}

export type GlobalPayoutStatus = {
  enabled: boolean;
  configured: boolean;
  hasRecipient: boolean;
  status: string;
  country: string;
  defaultCurrency: string;
  payoutMethodReady: boolean;
  payoutReady: boolean;
  requirementsDueCount: number;
  disabledReason: string;
  stripeMode: StripeMode;
  recipientType: string;
};

function reqDueCount(requirementsJson: string): number {
  try {
    const parsed = JSON.parse(requirementsJson || "{}") as {
      currently_due?: unknown[];
      past_due?: unknown[];
    };
    const a = Array.isArray(parsed.currently_due) ? parsed.currently_due.length : 0;
    const b = Array.isArray(parsed.past_due) ? parsed.past_due.length : 0;
    return a + b;
  } catch {
    return 0;
  }
}

export async function getGlobalPayoutStatus(
  userId: string,
  mode?: StripeMode,
): Promise<GlobalPayoutStatus> {
  const stripeMode = normalizeStripeMode(mode ?? getStripeMode());
  // Flag OFF: no GP table reads — identical to Connect-only (safe before migration).
  if (!isGlobalPayoutsEnabled()) {
    return {
      enabled: false,
      configured: false,
      hasRecipient: false,
      status: "NOT_STARTED",
      country: "",
      defaultCurrency: "",
      payoutMethodReady: false,
      payoutReady: false,
      requirementsDueCount: 0,
      disabledReason: "",
      stripeMode,
      recipientType: "individual",
    };
  }
  const row = await prisma.globalPayoutRecipient.findUnique({
    where: { userId_stripeMode: { userId, stripeMode } },
  });
  const payoutReady = isGpRecipientPayoutReady(row);
  return {
    enabled: true,
    configured: hasGlobalPayoutsRestrictedKey(stripeMode),
    hasRecipient: Boolean(row?.stripeRecipientId),
    status: row?.status || "NOT_STARTED",
    country: row?.country || "",
    defaultCurrency: row?.defaultCurrency || "",
    payoutMethodReady: Boolean(row?.payoutMethodReady),
    payoutReady,
    requirementsDueCount: reqDueCount(row?.requirementsJson || "{}"),
    disabledReason: row?.disabledReason || "",
    stripeMode,
    recipientType: row?.recipientType || "individual",
  };
}

/**
 * Create or reuse a GP recipient shell, then return Stripe-hosted collection URL.
 * Ownership: stripeRecipientId is unique; never attach another user's recipient.
 */
export async function createGlobalPayoutOnboardingLink(opts: {
  userId: string;
  email: string;
  country: string;
  recipientType?: "individual" | "company";
  returnUrl: string;
  refreshUrl: string;
  mode?: StripeMode;
}): Promise<{ url: string; recipientId: string }> {
  if (!isGlobalPayoutsEnabled()) {
    throw Object.assign(new Error("Payout setup is not currently available."), {
      status: 503,
      code: "GLOBAL_PAYOUTS_DISABLED",
    });
  }
  const stripeMode = normalizeStripeMode(opts.mode ?? getStripeMode());
  if (!hasGlobalPayoutsRestrictedKey(stripeMode)) {
    throw Object.assign(new Error("Payout setup is not currently available."), {
      status: 503,
      code: "STRIPE_GP_NOT_CONFIGURED",
    });
  }

  const country = String(opts.country || "").trim().toUpperCase();
  if (!isGlobalPayoutsCountryAllowed(country)) {
    throw Object.assign(
      new Error("Payouts are not yet available in your location."),
      { status: 409, code: "PAYOUTS_UNAVAILABLE" },
    );
  }
  if (
    !isGlobalPayoutsUserAllowed({ userId: opts.userId, email: opts.email })
  ) {
    throw Object.assign(
      new Error("Payouts are not yet available for this account."),
      { status: 409, code: "PAYOUTS_UNAVAILABLE" },
    );
  }

  let row = await prisma.globalPayoutRecipient.findUnique({
    where: {
      userId_stripeMode: { userId: opts.userId, stripeMode },
    },
  });

  if (!row) {
    // Create recipient via Stripe API v2 Accounts with recipient configuration.
    // Money mutations not required for recipient create + hosted link.
    // Capability must match country payout method (TH → wire, not local).
    const bankMethod = recipientBankCapabilityForCountry(country);
    const created = await gpFetch({
      mode: stripeMode,
      method: "POST",
      path: "/v2/core/accounts",
      body: {
        contact_email: opts.email,
        display_name: opts.email,
        identity: {
          country,
          entity_type:
            opts.recipientType === "company" ? "company" : "individual",
        },
        configuration: {
          recipient: {
            capabilities: recipientCapabilitiesBody(country),
          },
        },
        include: [
          "requirements",
          "configuration.recipient",
          "identity",
        ],
        metadata: {
          sourceBridgeUserId: opts.userId,
          stripeMode,
          rail: "STRIPE_GLOBAL_PAYOUTS",
          gpBankMethod: bankMethod,
        },
      },
      // Include bank method so correcting local→wire does not replay a stale
      // idempotent create that requested an unavailable capability.
      idempotencyKey: `gp_recipient_${opts.userId}_${stripeMode}_${country}_${bankMethod}`,
    });

    if (!created.ok || typeof created.body.id !== "string") {
      throw Object.assign(new Error(gpErrorMessage(created)), {
        status: 502,
        code: "GP_RECIPIENT_CREATE_FAILED",
      });
    }

    const recipientId = created.body.id;
    // Enforce unique ownership — refuse if another user already owns this id.
    const clash = await prisma.globalPayoutRecipient.findUnique({
      where: { stripeRecipientId: recipientId },
    });
    if (clash && clash.userId !== opts.userId) {
      throw Object.assign(
        new Error("Recipient ownership conflict"),
        { status: 409, code: "GP_RECIPIENT_OWNERSHIP" },
      );
    }

    row = await prisma.globalPayoutRecipient.create({
      data: {
        userId: opts.userId,
        stripeMode,
        stripeRecipientId: recipientId,
        status: "PENDING",
        country,
        recipientType: opts.recipientType === "company" ? "company" : "individual",
      },
    });
  } else if (row.country && row.country !== country) {
    throw Object.assign(
      new Error(
        "Recipient country cannot be changed after onboarding. Contact support.",
      ),
      { status: 409, code: "GP_COUNTRY_LOCKED" },
    );
  }

  const link = await gpFetch({
    mode: stripeMode,
    method: "POST",
    path: "/v2/core/account_links",
    body: {
      account: row.stripeRecipientId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["recipient"],
          refresh_url: opts.refreshUrl,
          return_url: opts.returnUrl,
        },
      },
    },
    idempotencyKey: `gp_link_${row.stripeRecipientId}_${Date.now()}`,
  });

  const url =
    typeof link.body.url === "string"
      ? link.body.url
      : typeof (link.body as { account_link?: { url?: string } }).account_link
            ?.url === "string"
        ? (link.body as { account_link: { url: string } }).account_link.url
        : "";

  if (!link.ok || !url) {
    throw Object.assign(new Error(gpErrorMessage(link)), {
      status: 502,
      code: "GP_ONBOARDING_LINK_FAILED",
    });
  }

  return { url, recipientId: row.stripeRecipientId };
}

export async function syncGlobalPayoutRecipient(
  userId: string,
  mode?: StripeMode,
) {
  const stripeMode = normalizeStripeMode(mode ?? getStripeMode());
  const row = await prisma.globalPayoutRecipient.findUnique({
    where: { userId_stripeMode: { userId, stripeMode } },
  });
  if (!row) return null;
  if (!hasGlobalPayoutsRestrictedKey(stripeMode)) return row;

  const retrieved = await gpFetch({
    mode: stripeMode,
    method: "GET",
    path: `/v2/core/accounts/${encodeURIComponent(row.stripeRecipientId)}?include=requirements&include=configuration.recipient&include=identity&include=defaults`,
  });
  if (!retrieved.ok) {
    return row;
  }

  const body = retrieved.body;
  const config =
    body.configuration && typeof body.configuration === "object"
      ? (body.configuration as Record<string, unknown>)
      : {};
  const recipient =
    config.recipient && typeof config.recipient === "object"
      ? (config.recipient as Record<string, unknown>)
      : {};
  const caps = recipient.capabilities ?? body.capabilities ?? {};
  const requirements = recipient.requirements ?? body.requirements ?? {};
  const defaults =
    body.defaults && typeof body.defaults === "object"
      ? (body.defaults as Record<string, unknown>)
      : {};
  const defaultPmMap =
    defaults.payout_methods && typeof defaults.payout_methods === "object"
      ? (defaults.payout_methods as Record<string, unknown>)
      : {};

  // Payout methods: list under Stripe-Context = recipient Account id
  // (official GP scoping). Do not rely on `?account=` query alone.
  let payoutMethodId = row.defaultPayoutMethodId;
  let payoutMethodReady = row.payoutMethodReady;
  const preferWire =
    recipientBankCapabilityForCountry(row.country || "") === "wire";
  const methods = await gpFetch({
    mode: stripeMode,
    method: "GET",
    path: `/v2/money_management/payout_methods?limit=10`,
    stripeContext: row.stripeRecipientId,
  });
  if (methods.ok && Array.isArray(methods.body.data)) {
    const picked = pickReadyPayoutMethodId(methods.body.data, { preferWire });
    if (picked) {
      payoutMethodId = picked.id;
      payoutMethodReady = picked.ready;
    }
  }
  // Fallback: account defaults.payout_methods map (currency → pm id).
  if (!payoutMethodReady) {
    const defaultIds = Object.values(defaultPmMap).filter(
      (v): v is string => typeof v === "string" && v.trim().length > 0,
    );
    if (defaultIds.length > 0) {
      payoutMethodId = defaultIds[0];
      payoutMethodReady = true;
    }
  }

  const due =
    requirements && typeof requirements === "object"
      ? (requirements as { currently_due?: unknown[]; past_due?: unknown[] })
      : {};
  const dueCount =
    (Array.isArray(due.currently_due) ? due.currently_due.length : 0) +
    (Array.isArray(due.past_due) ? due.past_due.length : 0);

  let status = row.status;
  if (payoutMethodReady && dueCount === 0) status = "ACTIVE";
  else if (dueCount > 0) status = "ACTION_REQUIRED";
  else if (String(body.status || "").toLowerCase() === "rejected") {
    status = "REJECTED";
  } else if (String(body.status || "").toLowerCase() === "restricted") {
    status = "RESTRICTED";
  } else {
    status = "PENDING";
  }

  return prisma.globalPayoutRecipient.update({
    where: { id: row.id },
    data: {
      status,
      payoutMethodReady,
      defaultPayoutMethodId: payoutMethodId || "",
      capabilitiesJson: JSON.stringify(caps).slice(0, 8000),
      requirementsJson: JSON.stringify(requirements).slice(0, 8000),
      lastSyncedAt: new Date(),
    },
  });
}

export async function syncGlobalPayoutRecipientByStripeId(
  stripeRecipientId: string,
  mode?: StripeMode,
) {
  const row = await prisma.globalPayoutRecipient.findUnique({
    where: { stripeRecipientId },
  });
  if (!row) return null;
  return syncGlobalPayoutRecipient(
    row.userId,
    normalizeStripeMode(mode ?? row.stripeMode),
  );
}
