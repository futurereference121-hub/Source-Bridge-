/**
 * Admin Protected-payment decision copy and confirmation state.
 * Authorization is separate from provider payout success.
 */

import { formatMinor } from "@/lib/payments/money";

export type AdminPayoutPhase = "none" | "pending" | "sent" | "failed";

export function isGlobalPayoutsRail(rail?: string | null): boolean {
  return String(rail || "").trim().toUpperCase() === "STRIPE_GLOBAL_PAYOUTS";
}

export function adminConfirmReleaseSentence(opts: {
  payoutRail?: string | null;
  releaseMinor: number;
  currency: string;
}): string {
  const amount = formatMinor(opts.releaseMinor, opts.currency);
  if (isGlobalPayoutsRail(opts.payoutRail)) {
    return `Release ${amount} to the seller via Global Payouts.`;
  }
  return `Release ${amount} to the seller Connect account.`;
}

export function adminReleaseConfirmedCopy(
  authorizedMinor: number,
  currency: string,
): string {
  return `Release confirmed: ${formatMinor(authorizedMinor, currency)}`;
}

export function adminPayoutPhaseFromOutbound(
  status?: string | null,
): AdminPayoutPhase {
  const s = String(status || "").trim().toUpperCase();
  if (s === "SUCCEEDED" || s === "RECONCILED") return "sent";
  if (s === "FAILED" || s === "RETURNED") return "failed";
  if (!s) return "none";
  return "pending";
}

export function adminPayoutStatusCopy(phase: AdminPayoutPhase): string | null {
  if (phase === "pending") return "Payout pending";
  if (phase === "sent") return "Payout sent";
  if (phase === "failed") return "Payout failed";
  return null;
}

/** 409 codes that mean the seller-release authorization already exists. */
export const ADMIN_RELEASE_ALREADY_ACCEPTED_CODES = [
  "ALREADY_RELEASED",
  "GP_PAYMENT_IN_FLIGHT",
  "GP_PURCHASE_FUNDING_UNCONFIRMED",
] as const;

export function adminReleaseAlreadyAccepted(code?: string | null): boolean {
  const value = String(code || "");
  return (ADMIN_RELEASE_ALREADY_ACCEPTED_CODES as readonly string[]).includes(
    value,
  );
}

export function deriveAdminReleaseDecisionView(opts: {
  payoutRail?: string | null;
  currency: string;
  alreadyReleasedMinor: number;
  finalResidualMinor: number;
  authorizedReleaseMinor?: number | null;
  outboundStatus?: string | null;
}): {
  decisionLocked: boolean;
  authorizedMinor: number;
  confirmedCopy: string | null;
  payoutPhase: AdminPayoutPhase;
  payoutCopy: string | null;
} {
  const transferred = Math.max(0, Math.trunc(opts.alreadyReleasedMinor || 0));
  const outboundAuthorized = Math.max(
    0,
    Math.trunc(opts.authorizedReleaseMinor || 0),
  );
  const gp = isGlobalPayoutsRail(opts.payoutRail);
  const authorizedMinor = gp
    ? Math.max(transferred, outboundAuthorized)
    : transferred;
  const payoutPhase = gp
    ? adminPayoutPhaseFromOutbound(opts.outboundStatus)
    : authorizedMinor > 0 && opts.finalResidualMinor <= 0
      ? "sent"
      : authorizedMinor > 0
        ? "pending"
        : "none";
  const decisionLocked = gp
    ? outboundAuthorized > 0 || (authorizedMinor > 0 && opts.finalResidualMinor <= 0)
    : opts.finalResidualMinor <= 0 && authorizedMinor > 0;
  return {
    decisionLocked,
    authorizedMinor,
    confirmedCopy: decisionLocked
      ? adminReleaseConfirmedCopy(
          authorizedMinor || outboundAuthorized || transferred,
          opts.currency,
        )
      : null,
    payoutPhase,
    payoutCopy: adminPayoutStatusCopy(payoutPhase),
  };
}
