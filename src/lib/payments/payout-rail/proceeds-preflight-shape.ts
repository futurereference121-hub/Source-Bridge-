import { createHash } from "node:crypto";

/** SHA-256 hex, first 8 characters. Safe to log; not a credential. */
export function idHash8(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export function last5(value: string): string {
  const trimmed = String(value || "").trim();
  return trimmed.length >= 5 ? trimmed.slice(-5) : "";
}

/**
 * The authorized £40.25 TEST purchase. Matched by hash so the raw ids are
 * not stored in this file.
 */
export const APPROVED_GP_TEST_PURCHASE = {
  txnHash: "597151ee",
  buyerHash: "705e5c58",
  sourcerHash: "87a7abb2",
  stripeMode: "TEST",
  payoutRail: "STRIPE_GLOBAL_PAYOUTS",
  currency: "GBP",
  totalChargeMinor: 4025,
} as const;

export const UNVERIFIED_WRITE_PERMISSIONS = [
  "payouts.create",
  "quote",
  "payout_schedule_update",
  "top_up",
  "transfer",
  "refund",
] as const;

export type ApprovedPurchaseRow = {
  id: string;
  buyerId: string;
  sellerId: string;
  stripeChargeId: string;
  stripeMode: string;
  payoutRail: string;
  currency: string;
  totalChargeMinor: number;
  status: string;
};

export const DAMAGED_GP_TEST_PURCHASE_REF = {
  txnHash: "b8444fb7",
  buyerHash: "705e5c58",
  sourcerHash: "87a7abb2",
  stripeMode: "TEST",
  payoutRail: "STRIPE_GLOBAL_PAYOUTS",
  currency: "GBP",
  totalChargeMinor: 4025,
} as const;

function selectHashedTestPurchase<T extends ApprovedPurchaseRow>(
  rows: readonly T[],
  ref: typeof APPROVED_GP_TEST_PURCHASE | typeof DAMAGED_GP_TEST_PURCHASE_REF,
): T | null {
  const matches = rows.filter(
    (row) =>
      row.stripeMode === ref.stripeMode &&
      row.payoutRail === ref.payoutRail &&
      row.currency.toUpperCase() === ref.currency &&
      row.totalChargeMinor === ref.totalChargeMinor &&
      idHash8(row.id) === ref.txnHash &&
      idHash8(row.buyerId) === ref.buyerHash &&
      idHash8(row.sellerId) === ref.sourcerHash,
  );
  return matches.length === 1 ? matches[0] : null;
}

export function selectApprovedTestPurchase<T extends ApprovedPurchaseRow>(rows: readonly T[]): T | null {
  return selectHashedTestPurchase(rows, APPROVED_GP_TEST_PURCHASE);
}

export function selectDamagedTestPurchase<T extends ApprovedPurchaseRow>(rows: readonly T[]): T | null {
  return selectHashedTestPurchase(rows, DAMAGED_GP_TEST_PURCHASE_REF);
}

export function webhookEventCoverage(
  enabled: readonly string[],
  required: readonly string[],
): { covered: string[]; missing: string[] } {
  const have = new Set(enabled);
  return {
    covered: required.filter((event) => have.has(event)),
    missing: required.filter((event) => !have.has(event)),
  };
}

export type ChargeReadFacts = {
  suffix: string;
  grossMinor: number;
  feeMinor: number;
  netMinor: number;
  balanceStatus: string;
  availableOn: string | null;
  currency: string;
  livemode: false;
};

/** Drop a live charge, and keep only the figures the preflight is allowed to show. */
export function safeChargeFacts(opts: {
  id: string;
  livemode: boolean;
  currency: string;
  grossMinor: number;
  feeMinor: number;
  netMinor: number;
  balanceStatus: string;
  availableOn: string | null;
}): { facts: ChargeReadFacts } | { blocked: "mode_mismatch" } {
  if (opts.livemode !== false) return { blocked: "mode_mismatch" };
  if (opts.currency.toUpperCase() !== "GBP") return { blocked: "mode_mismatch" };
  return {
    facts: {
      suffix: last5(opts.id),
      grossMinor: opts.grossMinor,
      feeMinor: opts.feeMinor,
      netMinor: opts.netMinor,
      balanceStatus: opts.balanceStatus,
      availableOn: opts.availableOn,
      currency: "GBP",
      livemode: false,
    },
  };
}
