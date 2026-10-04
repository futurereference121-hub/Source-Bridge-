import type { StripeMode } from "../flags.ts";

export function isGpRecipientPayoutReady(row: {
  status: string;
  payoutMethodReady: boolean;
  defaultPayoutMethodId?: string | null;
  stripeRecipientId?: string | null;
} | null | undefined): boolean {
  if (!row) return false;
  if (!row.stripeRecipientId) return false;
  if (!row.payoutMethodReady) return false;
  if (!String(row.defaultPayoutMethodId || "").trim()) return false;
  const status = String(row.status || "").toUpperCase();
  return status === "ACTIVE";
}

export type StoredGlobalPayoutRecipient = {
  stripeRecipientId?: string | null;
  status?: string | null;
  country?: string | null;
  defaultCurrency?: string | null;
  payoutMethodReady?: boolean | null;
  defaultPayoutMethodId?: string | null;
  disabledReason?: string | null;
  requirementsJson?: string | null;
  recipientType?: string | null;
};

export type GlobalPayoutStatusView = {
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

/** Map a stored recipient row into the status payload. No Stripe call. */
export function projectStoredGlobalPayoutStatus(opts: {
  enabled: boolean;
  configured: boolean;
  stripeMode: StripeMode;
  row: StoredGlobalPayoutRecipient | null;
}): GlobalPayoutStatusView {
  if (!opts.enabled) {
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
      stripeMode: opts.stripeMode,
      recipientType: "individual",
    };
  }
  const row = opts.row;
  const payoutReady = isGpRecipientPayoutReady(
    row
      ? {
          status: row.status || "",
          payoutMethodReady: Boolean(row.payoutMethodReady),
          defaultPayoutMethodId: row.defaultPayoutMethodId,
          stripeRecipientId: row.stripeRecipientId,
        }
      : null,
  );
  return {
    enabled: true,
    configured: opts.configured,
    hasRecipient: Boolean(row?.stripeRecipientId),
    status: row?.status || "NOT_STARTED",
    country: row?.country || "",
    defaultCurrency: row?.defaultCurrency || "",
    payoutMethodReady: Boolean(row?.payoutMethodReady),
    payoutReady,
    requirementsDueCount: reqDueCount(row?.requirementsJson || "{}"),
    disabledReason: row?.disabledReason || "",
    stripeMode: opts.stripeMode,
    recipientType: row?.recipientType || "individual",
  };
}

/** Country is locked once Connect or the mode-resolved GP recipient exists. */
export function payoutCountryLocked(opts: {
  connectHasAccount: boolean;
  gpHasRecipient: boolean;
}): boolean {
  return Boolean(opts.connectHasAccount || opts.gpHasRecipient);
}
