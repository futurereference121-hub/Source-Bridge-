/**
 * Seller / buyer / admin display labels for Global Payouts outbound attempts.
 * Never claim "paid" while provider is still processing (pendingProvider).
 */

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

export function deriveOutboundDisplayState(
  status: string | null | undefined,
): OutboundDisplayState {
  const s = String(status || "")
    .trim()
    .toUpperCase();

  switch (s) {
    case "SUCCEEDED":
    case "RECONCILED":
      return {
        phase: "completed",
        sellerLabel: "Payout completed",
        buyerLabel: "Released to sourcer",
        adminLabel: "SUCCEEDED",
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
    case "AWAITING_FA_FUNDS":
      return {
        phase: "awaiting_funds",
        sellerLabel: "Payout waiting on platform funding",
        buyerLabel: "Release authorized — payout pending platform funding",
        adminLabel: "AWAITING_FA_FUNDS",
        pendingProvider: true,
        needsAdminAction: true,
      };
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
