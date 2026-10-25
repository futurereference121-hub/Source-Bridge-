/**
 * Seller / buyer / admin display labels for Global Payouts outbound attempts.
 * Never claim "paid" while provider is still processing (pendingProvider).
 * Buyer progress for an authorized payout comes from the server status.
 * This label does not promise that funding will continue.
 */
import {
  classifyGpAwaitingFunds,
  gpAwaitingFundsHeadline,
  type GpAwaitingFundsKind,
} from "./proceeds-funding.ts";

export type OutboundFundingDisplay = {
  proceedsFundingEnabled?: boolean | null;
  configurationBlocked?: boolean | null;
  chargeAvailable?: boolean | null;
  fundingStatus?: string | null;
  failureCode?: string | null;
};

export type OutboundDisplayPhase =
  | "none"
  | "pending"
  | "processing"
  | "awaiting_funds"
  | "awaiting_minimum"
  | "action_required"
  | "completed"
  | "failed"
  | "returned"
  | "manual_review";

export type OutboundDisplayState = {
  phase: OutboundDisplayPhase;
  /** Seller-facing short label */
  sellerLabel: string;
  /** Buyer-facing protected-payment consistent label */
  buyerLabel: string;
  /** Admin ops label */
  adminLabel: string;
  /** True when UI must not claim funds are paid out yet */
  pendingProvider: boolean;
  /** True when admin reconcile / review is actionable */
  needsAdminAction: boolean;
};

const SAFE_FAILURE_MAX = 200;

/** Redact PAN-like sequences and truncate for storage / UI. */
export function sanitizeProviderFailureText(
  raw: string | null | undefined,
): string {
  const s = String(raw || "")
    .replace(/\b\d{12,19}\b/g, "[redacted]")
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi, "[redacted]")
    .replace(/sk_(live|test)_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/rk_(live|test)_[A-Za-z0-9]+/g, "[redacted]")
    .trim();
  return s.slice(0, SAFE_FAILURE_MAX);
}

export const GP_POSTED_WORDING =
  "Posted means funds left the financial account. It does not confirm the recipient bank has paid.";

export function deriveOutboundDisplayState(
  status: string | null | undefined,
  failureCode?: string | null,
  funding?: OutboundFundingDisplay | null,
): OutboundDisplayState {
  const s = String(status || "")
    .trim()
    .toUpperCase();
  if (s === "PROCESSING" && failureCode === "GP_UNDER_REVIEW") {
    return {
      phase: "manual_review",
      sellerLabel: "Payout under review",
      buyerLabel: "Release pending provider review",
      adminLabel: "UNDER_REVIEW — payment not finalized",
      pendingProvider: true,
      needsAdminAction: false,
    };
  }

  switch (s) {
    case "SUCCEEDED":
    case "RECONCILED":
      return {
        phase: "completed",
        sellerLabel: "Payout sent — funds left the financial account",
        buyerLabel: "Released to sourcer",
        adminLabel: GP_POSTED_WORDING,
        pendingProvider: false,
        needsAdminAction: false,
      };
    case "PROCESSING":
      return {
        phase: "processing",
        sellerLabel: "Payout in progress",
        buyerLabel: "Release in progress — payout confirming",
        adminLabel: "PROCESSING",
        pendingProvider: true,
        needsAdminAction: false,
      };
    case "PENDING":
      return {
        phase: "pending",
        sellerLabel: "Payout pending",
        buyerLabel: "Release pending",
        adminLabel: "PENDING",
        pendingProvider: true,
        needsAdminAction: false,
      };
    case "AWAITING_FA_FUNDS": {
      const kind: GpAwaitingFundsKind = classifyGpAwaitingFunds({
        proceedsFundingEnabled: funding?.proceedsFundingEnabled,
        configurationBlocked: funding?.configurationBlocked,
        chargeAvailable: funding?.chargeAvailable,
        fundingStatus: funding?.fundingStatus,
        failureCode: funding?.failureCode ?? failureCode,
      });
      return {
        phase: "awaiting_funds",
        sellerLabel:
          kind === "review"
            ? "Payout under review"
            : kind === "funding_in_progress"
              ? "Payout funding in progress"
              : kind === "funding_confirmed"
                ? "Payout funding confirmed"
                : kind === "funding_awaited"
                  ? "Payout waiting to be funded"
                  : kind === "unknown"
                    ? "Checking payout status"
                    : "Payout waiting for payment to become available",
        buyerLabel: gpAwaitingFundsHeadline(kind),
        adminLabel: `AWAITING_FA_FUNDS:${kind}`,
        pendingProvider: true,
        needsAdminAction: kind === "review",
      };
    }
    case "AWAITING_MINIMUM":
      return {
        phase: "awaiting_minimum",
        sellerLabel: "Payout below local minimum",
        buyerLabel: "Release authorized — payout awaiting minimum",
        adminLabel: "AWAITING_MINIMUM",
        pendingProvider: true,
        needsAdminAction: true,
      };
    case "ACTION_REQUIRED":
      return {
        phase: "action_required",
        sellerLabel: "Payout needs attention",
        buyerLabel: "Release paused — payout needs attention",
        adminLabel: "ACTION_REQUIRED",
        pendingProvider: true,
        needsAdminAction: true,
      };
    case "FAILED":
      return {
        phase: "failed",
        sellerLabel: "Payout failed",
        buyerLabel: "Release not completed — funds remain protected",
        adminLabel: "FAILED",
        pendingProvider: false,
        needsAdminAction: true,
      };
    case "RETURNED":
      return {
        phase: "returned",
        sellerLabel: "Payout returned — under review",
        buyerLabel: "Payout returned — Source Bridge is reviewing",
        adminLabel: "RETURNED — manual review",
        pendingProvider: false,
        needsAdminAction: true,
      };
    default:
      return {
        phase: "none",
        sellerLabel: "",
        buyerLabel: "",
        adminLabel: s || "UNKNOWN",
        pendingProvider: false,
        needsAdminAction: false,
      };
  }
}

/** API / UI contract when release returns pendingProvider. */
export function pendingProviderReleaseMessage(kind: "PROCUREMENT" | "FINAL"): string {
  if (kind === "PROCUREMENT") {
    return "Item-fund release submitted. Payout is confirming with the provider — not yet marked paid.";
  }
  return "Final release submitted. Payout is confirming with the provider — not yet marked paid.";
}
