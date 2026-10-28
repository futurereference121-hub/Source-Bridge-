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
      ? "Completed — international payout has been sent."
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

export type ProcurementPayoutStatus =
  | "awaiting_settlement"
  | "funding"
  | "processing"
  | "succeeded"
  | "failed";

/**
 * Cash still owed to the sourcer after the item advance. The books field
 * remainingProtectedSellerShareMinor is the agreed remainder structure and
 * does not fall when FINAL pays. Subtract finalTransferredMinor for display.
 */
export function procurementRemainderHeldMinor(opts: {
  remainingProtectedSellerShareMinor?: number | null;
  shippingMinor?: number | null;
  sellerServiceFeeMinor?: number | null;
  finalTransferredMinor?: number | null;
}): number {
  const agreed =
    typeof opts.remainingProtectedSellerShareMinor === "number"
      ? Math.max(0, opts.remainingProtectedSellerShareMinor)
      : Math.max(0, (opts.shippingMinor ?? 0) + (opts.sellerServiceFeeMinor ?? 0));
  return Math.max(0, agreed - Math.max(0, opts.finalTransferredMinor ?? 0));
}

/** Provider FINAL success overrides a stale remaining-held remainder. */
export function finalRemainderSent(opts: {
  status?: string | null;
  outboundKind?: string | null;
  outboundStatus?: string | null;
  gpPhase?: string | null;
  remainingHeldMinor?: number | null;
  finalPaidMinor?: number | null;
}): boolean {
  const status = String(opts.status || "").toUpperCase();
  const kind = String(opts.outboundKind || "").toUpperCase();
  const outbound = String(opts.outboundStatus || "").toUpperCase();
  const phase = String(opts.gpPhase || "").toLowerCase();
  const paid = Math.max(0, opts.finalPaidMinor ?? 0);
  const held = Math.max(0, opts.remainingHeldMinor ?? 0);
  if (outbound === "FAILED" || outbound === "RETURNED") return false;
  if (kind === "FINAL" && (outbound === "SUCCEEDED" || outbound === "RECONCILED")) {
    return true;
  }
  if (kind === "FINAL" && phase === "sent") return true;
  if (status === "RELEASED" && paid > 0) return true;
  return paid > 0 && held <= 0;
}

export function sourceBridgeFeeLineLabel(completed: boolean): string {
  return completed
    ? "Source Bridge platform fee"
    : "Source Bridge platform fee (held)";
}

export function describeProcurementPayoutStatus(opts: {
  transferredMinor?: number | null;
  outboundKind?: string | null;
  outboundStatus?: string | null;
  outboundIdPresent?: boolean | null;
  fundingStatus?: string | null;
  gpPhase?: string | null;
}): ProcurementPayoutStatus {
  if ((opts.transferredMinor ?? 0) > 0) return "succeeded";
  const outbound = String(opts.outboundStatus || "").toUpperCase();
  const kind = String(opts.outboundKind || "").toUpperCase();
  const funding = String(opts.fundingStatus || "").toUpperCase();
  const phase = String(opts.gpPhase || "").toLowerCase();
  if (kind === "PROCUREMENT" && outbound === "FAILED") return "failed";
  if (kind === "PROCUREMENT" && (outbound === "SUCCEEDED" || outbound === "RECONCILED")) {
    return "succeeded";
  }
  if (phase === "failed") return "failed";
  if (phase === "sent") return "succeeded";
  if (
    phase === "sending" ||
    (kind === "PROCUREMENT" &&
      (outbound === "PROCESSING" || outbound === "PENDING") &&
      opts.outboundIdPresent)
  ) {
    return "processing";
  }
  if (funding === "POSTED" || funding === "FUNDING" || phase === "waiting_funding") {
    return funding === "POSTED" ? "processing" : "funding";
  }
  if (funding === "SHORT") return "funding";
  return "awaiting_settlement";
}

export function procurementPayoutStatusLabel(status: ProcurementPayoutStatus): string {
  if (status === "awaiting_settlement") return "awaiting settlement";
  return status;
}

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

function finalRemainderAuthorized(opts: {
  status?: string | null;
  outboundKind?: string | null;
  outboundStatus?: string | null;
}): boolean {
  const outbound = String(opts.outboundStatus || "").toUpperCase();
  if (outbound === "FAILED" || outbound === "RETURNED") return false;
  const status = String(opts.status || "").toUpperCase();
  if (status === "READY_TO_RELEASE" || status === "RELEASED") return true;
  const kind = String(opts.outboundKind || "").toUpperCase();
  return kind === "FINAL" && Boolean(outbound);
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
  outboundIdPresent?: boolean | null;
  fundingStatus?: string | null;
  gpPhase?: string | null;
  finalPaidMinor?: number | null;
  remainderAuthorizedMinor?: number | null;
  platformFeeMinor?: number | null;
  currency: string;
  formatMinor: (minor: number, currency: string) => string;
}): {
  headline: string;
  detail: string | null;
  remainderLabel: string | null;
  authorizedAdvanceMinor: number;
  paidAdvanceMinor: number;
  remainderHeldMinor: number;
  remainderDisplayMinor: number;
  payoutStatus: ProcurementPayoutStatus;
  payoutStatusLabel: string;
} {
  const agreed = Boolean(opts.agreed) && opts.advanceMinor > 0;
  const status = String(opts.status || "").toUpperCase();
  const finalReleased = status === "RELEASED" || status === "READY_TO_RELEASE";
  const advance = agreed ? opts.formatMinor(opts.advanceMinor, opts.currency) : "";
  const remaining =
    opts.remainingHeldMinor > 0
      ? opts.formatMinor(opts.remainingHeldMinor, opts.currency)
      : "";

  const paidAdvanceMinor = Math.max(0, opts.transferredMinor);
  const authorizedAdvanceMinor = agreed ? opts.advanceMinor : 0;
  const remainderHeldMinor = Math.max(0, opts.remainingHeldMinor);
  const finalPaidMinor = Math.max(0, opts.finalPaidMinor ?? 0);
  const remainderAuthorizedMinor = Math.max(
    0,
    opts.remainderAuthorizedMinor ?? remainderHeldMinor + finalPaidMinor,
  );
  const payoutStatus = describeProcurementPayoutStatus({
    transferredMinor: paidAdvanceMinor,
    outboundKind: opts.outboundKind,
    outboundStatus: opts.outboundStatus,
    outboundIdPresent: opts.outboundIdPresent,
    fundingStatus: opts.fundingStatus,
    gpPhase: opts.gpPhase,
  });
  const payoutStatusLabel = procurementPayoutStatusLabel(payoutStatus);
  const remainderSent = finalRemainderSent({
    status: opts.status,
    outboundKind: opts.outboundKind,
    outboundStatus: opts.outboundStatus,
    gpPhase: opts.gpPhase,
    remainingHeldMinor: remainderHeldMinor,
    finalPaidMinor,
  });
  const remainderPending = !remainderSent && remainderHeldMinor > 0;
  const remainderAuthorized = finalRemainderAuthorized({
    status: opts.status,
    outboundKind: opts.outboundKind,
    outboundStatus: opts.outboundStatus,
  });
  const remainderDisplayMinor = remainderSent
    ? finalPaidMinor || remainderAuthorizedMinor
    : remainderHeldMinor;
  const remainderAmountText =
    remainderDisplayMinor > 0
      ? opts.formatMinor(remainderDisplayMinor, opts.currency)
      : remaining
        ? remaining
        : remainderAuthorizedMinor > 0
          ? opts.formatMinor(remainderAuthorizedMinor, opts.currency)
          : "";
  const feeAmountText =
    typeof opts.platformFeeMinor === "number" && opts.platformFeeMinor > 0
      ? opts.formatMinor(opts.platformFeeMinor, opts.currency)
      : "";
  const remainderLabel = remainderPending
    ? remainderAuthorized
      ? `Final ${remainderAmountText} release authorized — payout pending`
      : `Shipping + sourcer fee awaiting final release`
    : remainderSent
      ? "Final remainder sent"
      : null;
  const remainderDetail = remainderPending
    ? remainderAuthorized
      ? `Final ${remainderAmountText} release authorized, payout pending.`
      : `Shipping + sourcer fee awaiting final release: ${remainderAmountText}.`
    : remainderSent && remainderAmountText
      ? [
          `Final remainder sent: ${remainderAmountText}.`,
          `Total sent to sourcer: ${opts.formatMinor(
            paidAdvanceMinor + (finalPaidMinor || remainderAuthorizedMinor),
            opts.currency,
          )}.`,
          `Awaiting release: ${opts.formatMinor(0, opts.currency)}.`,
          feeAmountText
            ? `Source Bridge platform fee: ${feeAmountText}, kept on platform.`
            : "Source Bridge platform fee kept on platform.",
        ].join(" ")
      : null;
  const payoutDetail = `Payout stage: ${payoutStatusLabel}.`;
  const submitted =
    payoutStatus === "processing" ||
    payoutStatus === "succeeded" ||
    Boolean(opts.outboundIdPresent);

  const stage = {
    remainderLabel,
    authorizedAdvanceMinor,
    paidAdvanceMinor,
    remainderHeldMinor,
    remainderDisplayMinor,
    payoutStatus,
    payoutStatusLabel,
  };
  if (!agreed) {
    return {
      headline: "Procurement advance: not requested",
      detail: null,
      remainderLabel: null,
      authorizedAdvanceMinor: 0,
      paidAdvanceMinor,
      remainderHeldMinor,
      remainderDisplayMinor,
      payoutStatus,
      payoutStatusLabel,
    };
  }
  if (paidAdvanceMinor > 0 || payoutStatus === "succeeded") {
    return {
      headline: `Item funds sent: ${advance}.`,
      detail: [payoutDetail, remainderDetail].filter(Boolean).join(" "),
      ...stage,
    };
  }
  if (procurementAdvanceAuthorized({
    transferredMinor: 0,
    outboundKind: opts.outboundKind,
    outboundStatus: opts.outboundStatus,
  })) {
    if (submitted) {
      return {
        headline: `Item funds sent: ${advance} — bank delivery pending.`,
        detail: [payoutDetail, remainderDetail].filter(Boolean).join(" "),
        ...stage,
      };
    }
    return {
      headline: `Item release confirmed: ${advance}.`,
      detail: [
        `${advance} release confirmed — transfer pending.`,
        payoutDetail,
        remainderDetail,
      ]
        .filter(Boolean)
        .join(" "),
      ...stage,
    };
  }
  if (finalReleased && paidAdvanceMinor <= 0) {
    return {
      headline: `Procurement advance accepted: ${advance}`,
      detail: "Final release authorized. Shipping and sourcer fee follow the existing receipt rules.",
      ...stage,
    };
  }
  return {
    headline: `Procurement advance accepted: ${advance}`,
    detail: "Buyer authorizes item-fund release after funding. Shipping and sourcer fee stay held.",
    ...stage,
  };
}

export function receiptConfirmedCopy(role: "buyer" | "seller"): string {
  return role === "seller"
    ? "Receipt confirmed — buyer may release now or start a 12-hour inspection. Residual stays protected."
    : "Item received — choose release now or start a 12-hour inspection.";
}

export type TicketBottomStatusRow = {
  key: string;
  label: string;
  value: string;
};

export type ReleaseCellStatus =
  | "awaiting_authorization"
  | "authorization_confirmed"
  | "payout_pending"
  | "payout_processing"
  | "sent"
  | "failed";

const FINAL_OUTBOUND = new Set([
  "PENDING",
  "PROCESSING",
  "AWAITING_FA_FUNDS",
  "AWAITING_MINIMUM",
  "SUCCEEDED",
  "RECONCILED",
  "RETURNED",
  "FAILED",
]);

export function describeReleaseCellStatus(opts: {
  expectedKind: "PROCUREMENT" | "FINAL";
  authorized: boolean;
  transferredMinor?: number | null;
  outboundKind?: string | null;
  outboundStatus?: string | null;
}): ReleaseCellStatus {
  const kind = String(opts.outboundKind || "").toUpperCase();
  const outbound = String(opts.outboundStatus || "").toUpperCase();
  const matches = kind === opts.expectedKind;
  if (matches && outbound === "FAILED") return "failed";
  if ((opts.transferredMinor ?? 0) > 0) return "sent";
  if (matches && (outbound === "SUCCEEDED" || outbound === "RECONCILED")) {
    return "sent";
  }
  if (matches && outbound === "PROCESSING") return "payout_processing";
  if (
    matches &&
    (outbound === "PENDING" ||
      outbound === "AWAITING_FA_FUNDS" ||
      outbound === "AWAITING_MINIMUM")
  ) {
    return "payout_pending";
  }
  if (opts.authorized) return "authorization_confirmed";
  return "awaiting_authorization";
}

export function releaseCellStatusLabel(status: ReleaseCellStatus): string {
  switch (status) {
    case "awaiting_authorization":
      return "Awaiting authorization";
    case "authorization_confirmed":
      return "Authorization confirmed";
    case "payout_pending":
      return "Payout pending";
    case "payout_processing":
      return "Payout processing";
    case "sent":
      return "Sent";
    case "failed":
      return "Failed";
  }
}

/**
 * Availability of that purchase portion on Stripe — not released, sent, or
 * received. Consumed (paid-out) funds stay available; a passed date or buyer
 * approval alone is not evidence.
 */
export function stripePortionAvailability(opts: {
  payoutRail?: string | null;
  funded?: boolean | null;
  fundingStatus?: string | null;
  portionConsumed?: boolean | null;
}): "Available" | "Not yet available" {
  if (opts.portionConsumed) return "Available";
  if (isGlobalPayoutsRail(opts.payoutRail)) {
    return String(opts.fundingStatus || "").toUpperCase() === "POSTED"
      ? "Available"
      : "Not yet available";
  }
  return opts.funded ? "Available" : "Not yet available";
}

export function describeTicketItemStatus(opts: {
  status?: string | null;
  shipped?: boolean | null;
  delivered?: boolean | null;
  disputed?: boolean | null;
}): string {
  const status = String(opts.status || "").toUpperCase();
  if (opts.disputed || status === "DISPUTED") return "Issue reported";
  if (status === "RELEASED" || status === "READY_TO_RELEASE") return "Received";
  if (status === "IN_INSPECTION") return "Inspection";
  if (opts.delivered || status === "DELIVERED") return "Received";
  if (opts.shipped || status === "IN_TRANSIT" || status === "AWAITING_SHIPMENT") {
    return "Shipped — awaiting receipt";
  }
  return "Awaiting shipment";
}

function formatAmount(
  minor: number,
  currency: string,
  formatMinor: (minor: number, currency: string) => string,
): string {
  return formatMinor(Math.max(0, minor), currency);
}

/**
 * Concise bottom status rows for sourcing tickets. Omit inapplicable
 * procurement split rows when there is no item-fund advance.
 */
export function ticketBottomStatusRows(opts: {
  paymentOption?: string | null;
  payoutRail?: string | null;
  status: string;
  funded?: boolean | null;
  fundingStatus?: string | null;
  procurementAgreed?: boolean | null;
  itemCostMinor: number;
  remainderMinor: number;
  sellerEntitledMinor?: number | null;
  procurementTransferredMinor?: number | null;
  finalTransferredMinor?: number | null;
  outboundKind?: string | null;
  outboundStatus?: string | null;
  currency: string;
  shipped?: boolean | null;
  delivered?: boolean | null;
  disputed?: boolean | null;
  formatMinor: (minor: number, currency: string) => string;
}): TicketBottomStatusRow[] {
  const option = String(opts.paymentOption || "").toUpperCase();
  if (option === "INSTANT" || option === "DIRECT") return [];
  const status = String(opts.status || "").toUpperCase();
  if (
    !opts.funded &&
    ![
      "FUNDED",
      "PROCUREMENT_RELEASED",
      "AWAITING_SHIPMENT",
      "IN_TRANSIT",
      "DELIVERED",
      "IN_INSPECTION",
      "READY_TO_RELEASE",
      "RELEASED",
      "DISPUTED",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
    ].includes(status)
  ) {
    return [];
  }

  const procurementAgreed =
    Boolean(opts.procurementAgreed) && (opts.itemCostMinor ?? 0) > 0;
  const remainderMinor = Math.max(0, opts.remainderMinor);
  const itemMinor = Math.max(0, opts.itemCostMinor);
  const fullMinor =
    typeof opts.sellerEntitledMinor === "number" && opts.sellerEntitledMinor > 0
      ? opts.sellerEntitledMinor
      : itemMinor + remainderMinor;
  const procTransferred = Math.max(0, opts.procurementTransferredMinor ?? 0);
  const finalTransferred = Math.max(0, opts.finalTransferredMinor ?? 0);
  const outboundKind = opts.outboundKind;
  const outboundStatus = opts.outboundStatus;
  const finalAuthorized =
    status === "READY_TO_RELEASE" ||
    status === "RELEASED" ||
    (String(outboundKind || "").toUpperCase() === "FINAL" &&
      FINAL_OUTBOUND.has(String(outboundStatus || "").toUpperCase()) &&
      String(outboundStatus || "").toUpperCase() !== "FAILED");
  const itemAuthorized =
    procurementAgreed &&
    (procTransferred > 0 ||
      status === "PROCUREMENT_RELEASED" ||
      (String(outboundKind || "").toUpperCase() === "PROCUREMENT" &&
        PROCUREMENT_AUTHORIZED_OUTBOUND.has(
          String(outboundStatus || "").toUpperCase(),
        )));

  const rows: TicketBottomStatusRow[] = [];
  if (procurementAgreed) {
    rows.push({
      key: "item-funds-release",
      label: `Item funds release (${formatAmount(itemMinor, opts.currency, opts.formatMinor)})`,
      value: releaseCellStatusLabel(
        describeReleaseCellStatus({
          expectedKind: "PROCUREMENT",
          authorized: itemAuthorized,
          transferredMinor: procTransferred,
          outboundKind,
          outboundStatus,
        }),
      ),
    });
    rows.push({
      key: "shipping-sourcer-fee",
      label: `Shipping and sourcer fee (${formatAmount(remainderMinor, opts.currency, opts.formatMinor)})`,
      value: releaseCellStatusLabel(
        describeReleaseCellStatus({
          expectedKind: "FINAL",
          authorized: finalAuthorized,
          transferredMinor: finalTransferred,
          outboundKind,
          outboundStatus,
        }),
      ),
    });
    rows.push({
      key: "stripe-available-a",
      label: "Funds available on Stripe — A: item cost",
      value: stripePortionAvailability({
        payoutRail: opts.payoutRail,
        funded: opts.funded,
        fundingStatus: opts.fundingStatus,
        portionConsumed: procTransferred > 0,
      }),
    });
    rows.push({
      key: "stripe-available-b",
      label: "Funds available on Stripe — B: shipping and sourcer fee",
      value: stripePortionAvailability({
        payoutRail: opts.payoutRail,
        funded: opts.funded,
        fundingStatus: opts.fundingStatus,
        portionConsumed: finalTransferred > 0,
      }),
    });
  }

  const finalAmount = procurementAgreed ? remainderMinor : fullMinor;
  rows.push({
    key: "final-release",
    label: procurementAgreed
      ? "Final release"
      : `Final release (${formatAmount(finalAmount, opts.currency, opts.formatMinor)})`,
    value: releaseCellStatusLabel(
      describeReleaseCellStatus({
        expectedKind: "FINAL",
        authorized: finalAuthorized,
        transferredMinor: finalTransferred,
        outboundKind,
        outboundStatus,
      }),
    ),
  });

  if (!procurementAgreed) {
    rows.push({
      key: "stripe-available",
      label: "Funds available on Stripe",
      value: stripePortionAvailability({
        payoutRail: opts.payoutRail,
        funded: opts.funded,
        fundingStatus: opts.fundingStatus,
        portionConsumed: finalTransferred > 0,
      }),
    });
  }

  rows.push({
    key: "item-status",
    label: "Item status",
    value: describeTicketItemStatus({
      status,
      shipped: opts.shipped,
      delivered: opts.delivered,
      disputed: opts.disputed,
    }),
  });
  return rows;
}
