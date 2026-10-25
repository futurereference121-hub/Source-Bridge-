/**
 * Shared fulfilment / payout display copy for Connect and Global Payouts.
 * Labels only — does not change release, funding, or transfer execution.
 */

export const SHIPPED_AWAITING_RECEIPT_LABEL =
  "Shipped — awaiting receipt confirmation";
export const SHIPPED_AWAITING_RECEIPT_SHORT =
  "SHIPPED — AWAITING RECEIPT CONFIRMATION";
export const RECEIPT_CONFIRMED_LABEL =
  "Item received — choose release or inspection";
export const RECEIPT_CONFIRMED_SHORT = "ITEM RECEIVED";
export const INSPECTION_ACTIVE_LABEL = "Inspection active";

export const CONNECT_RELEASED_SELLER_COPY =
  "Completed — residual released to your connected account when the Connect transfer succeeded.";
export const CONNECT_RELEASING_SELLER_COPY =
  "Release authorized — Connect transfer in progress.";
export const CONNECT_RELEASED_BUYER_COPY =
  "Completed — funds released to the sourcer’s connected account.";
export const GP_RELEASING_FALLBACK_COPY =
  "Release authorized — international payout is in progress.";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export function isGlobalPayoutsRail(payoutRail: string | null | undefined): boolean {
  return String(payoutRail || "").trim().toUpperCase() === "STRIPE_GLOBAL_PAYOUTS";
}

export function formatInspectionWindow(
  endsAt: Date | string | null | undefined,
  nowMs = Date.now(),
): {
  deadlineLabel: string;
  remainingLabel: string;
  summary: string;
  expired: boolean;
  remainingMs: number;
} | null {
  if (!endsAt) return null;
  const endsMs = endsAt instanceof Date ? endsAt.getTime() : Date.parse(endsAt);
  if (!Number.isFinite(endsMs)) return null;
  const remainingMs = endsMs - nowMs;
  const deadlineLabel = new Date(endsMs).toLocaleString();
  if (remainingMs <= 0) {
    return {
      deadlineLabel,
      remainingLabel: "Inspection window ended",
      summary: `Inspection ended ${deadlineLabel}. Status will refresh from the server.`,
      expired: true,
      remainingMs,
    };
  }
  const hours = Math.floor(remainingMs / HOUR_MS);
  const minutes = Math.max(1, Math.ceil((remainingMs % HOUR_MS) / MINUTE_MS));
  const remainingLabel =
    hours > 0
      ? `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"} remaining`
      : `${minutes} minute${minutes === 1 ? "" : "s"} remaining`;
  return {
    deadlineLabel,
    remainingLabel,
    summary: `Inspection ends ${deadlineLabel} (${remainingLabel}). Remaining residual auto-releases after this deadline unless you release early or report a problem.`,
    expired: false,
    remainingMs,
  };
}

/** Delay until a silent reload after the server inspection deadline. */
export function inspectionReloadDelayMs(
  endsAt: Date | string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!endsAt) return null;
  const endsMs = endsAt instanceof Date ? endsAt.getTime() : Date.parse(endsAt);
  if (!Number.isFinite(endsMs)) return null;
  const delay = endsMs - nowMs + 400;
  if (delay > 12 * HOUR_MS + 10_000) return 12 * HOUR_MS + 10_000;
  return Math.max(0, delay);
}

export function sellerReleaseProgressCopy(opts: {
  status: string;
  payoutRail?: string | null;
  gpHeadline?: string | null;
}): string | null {
  const status = String(opts.status || "").toUpperCase();
  if (status !== "RELEASED" && status !== "READY_TO_RELEASE") return null;
  if (isGlobalPayoutsRail(opts.payoutRail)) {
    const headline = String(opts.gpHeadline || "").trim();
    if (headline) return headline;
    return status === "RELEASED"
      ? "Release authorized — checking international payout status."
      : GP_RELEASING_FALLBACK_COPY;
  }
  return status === "RELEASED"
    ? CONNECT_RELEASED_SELLER_COPY
    : CONNECT_RELEASING_SELLER_COPY;
}

export function connectCompletedBuyerCopy(): string {
  return CONNECT_RELEASED_BUYER_COPY;
}

export function shippedAwaitingReceiptCopy(role: "buyer" | "seller"): string {
  return role === "seller"
    ? "Shipped — awaiting receipt confirmation. Sellers cannot release residual funds."
    : "Item shipped — awaiting receipt confirmation.";
}

const PROCUREMENT_AUTHORIZED_OUTBOUND = new Set([
  "PENDING",
  "PROCESSING",
  "AWAITING_FA_FUNDS",
  "AWAITING_MINIMUM",
  "SUCCEEDED",
  "RECONCILED",
  "RETURNED",
]);

/** Buyer already authorized item-fund release. Paid only after transferredMinor > 0. */
export function procurementAdvanceAuthorized(opts: {
  transferredMinor?: number | null;
  status?: string | null;
  outboundKind?: string | null;
  outboundStatus?: string | null;
  hideReleaseActions?: boolean | null;
}): boolean {
  if ((opts.transferredMinor ?? 0) > 0) return true;
  if (String(opts.status || "").toUpperCase() === "PROCUREMENT_RELEASED") return true;
  const kind = String(opts.outboundKind || "").toUpperCase();
  const status = String(opts.outboundStatus || "").toUpperCase();
  if (status === "FAILED") return false;
  if (opts.hideReleaseActions) return true;
  return kind === "PROCUREMENT" && PROCUREMENT_AUTHORIZED_OUTBOUND.has(status);
}

export function describeProcurementStage(opts: {
  agreed: boolean;
  advanceMinor: number;
  transferredMinor: number;
  remainingHeldMinor: number;
  status: string;
  payoutRail?: string | null;
  outboundKind?: string | null;
  outboundStatus?: string | null;
  currency: string;
  formatMinor: (minor: number, currency: string) => string;
}): { headline: string; detail: string | null } {
  const agreed = Boolean(opts.agreed) && opts.advanceMinor > 0;
  const status = String(opts.status || "").toUpperCase();
  const finalReleased = status === "RELEASED" || status === "READY_TO_RELEASE";
  const advance = agreed ? opts.formatMinor(opts.advanceMinor, opts.currency) : "";
  const remaining =
    opts.remainingHeldMinor > 0
      ? opts.formatMinor(opts.remainingHeldMinor, opts.currency)
      : "";
  const procOutbound =
    String(opts.outboundKind || "").toUpperCase() === "PROCUREMENT"
      ? String(opts.outboundStatus || "").toUpperCase()
      : "";

  if (!agreed) {
    return { headline: "Procurement advance: not requested", detail: null };
  }
  if (opts.transferredMinor > 0) {
    return {
      headline: `Procurement advance paid: ${advance}`,
      detail: remaining
        ? `Remaining ${remaining} held until final release.`
        : finalReleased
          ? "Final release authorized."
          : null,
    };
  }
  if (procurementAdvanceAuthorized({
    transferredMinor: 0,
    outboundKind: opts.outboundKind,
    outboundStatus: opts.outboundStatus,
  })) {
    const pending =
      procOutbound === "AWAITING_FA_FUNDS" ||
      procOutbound === "PENDING" ||
      procOutbound === "AWAITING_MINIMUM";
    return {
      headline: pending
        ? `Item release authorized — payout pending: ${advance}`
        : `Item release authorized — payout processing: ${advance}`,
      detail: remaining
        ? `Authorized ${advance} is not marked paid until the provider confirms. Remaining ${remaining} (shipping + sourcer fee) stays protected.`
        : "Authorization is not provider confirmation or bank arrival.",
    };
  }
  if (finalReleased && opts.transferredMinor <= 0) {
    return {
      headline: `Procurement advance accepted: ${advance}`,
      detail: "Final release authorized. Shipping and sourcer fee follow the existing receipt rules.",
    };
  }
  return {
    headline: `Procurement advance accepted: ${advance}`,
    detail: "Buyer authorizes item-fund release after funding. Shipping and sourcer fee stay held.",
  };
}

export function receiptConfirmedCopy(role: "buyer" | "seller"): string {
  return role === "seller"
    ? "Receipt confirmed — buyer may release now or start a 12-hour inspection. Residual stays protected."
    : "Item received — choose release now or start a 12-hour inspection.";
}
