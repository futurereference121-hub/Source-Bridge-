/**
 * Buyer purchase card copy. Amounts are the stored minor units, not a new quote.
 */

import { formatMinor } from "@/lib/payments/money";
import { purchaseQuoteReviewKind } from "@/lib/payments/payout-rail/quote-confirmation";

export type PurchaseCardInput = {
  id?: string;
  status?: string;
  title?: string;
  currency?: string;
  totalChargeMinor?: number;
  protectionFeeMinor?: number;
  itemCostMinor?: number;
  shippingMinor?: number;
  sellerServiceFeeMinor?: number;
  payoutRail?: string | null;
  stripeMode?: string | null;
  globalPayouts?: { phase?: string; buyerLabel?: string } | null;
  displayState?: { label?: string; shortLabel?: string } | null;
  counterparty?: { username?: string | null; name?: string | null } | null;
  actions?: {
    canReleaseProcurement?: boolean;
    canReleaseNow?: boolean;
    canConfirmReceipt?: boolean;
    canReportIssue?: boolean;
  } | null;
};

export type PurchaseAmountLine = { label: string; text: string };

export type PurchaseCardModel = {
  seller: string;
  title: string;
  statusLabel: string;
  totalText: string;
  lines: PurchaseAmountLine[];
  payoutLabel: string | null;
  quoteKind: "PROCUREMENT" | "FINAL" | null;
  offersRelease: boolean;
  offersQuoteConfirmation: boolean;
};

/**
 * Buyer payout line. Posted means funds left the financial account.
 * It does not claim the recipient bank has paid.
 */
export function purchasePayoutPhrase(phase: string | null | undefined): string | null {
  switch (phase) {
    case "awaiting_funds":
      return "Release authorized — payout pending platform funding";
    case "awaiting_minimum":
      return "Release authorized — payout awaiting minimum";
    case "pending":
      return "Payout pending — not yet posted";
    case "processing":
      return "Payout confirming — not yet posted";
    case "manual_review":
      return "Release pending provider review";
    case "action_required":
      return "Release paused — payout needs attention";
    case "completed":
      return "Payout posted — this does not confirm the recipient bank has paid";
    case "failed":
      return "Payout failed — funds remain protected";
    case "returned":
      return "Payout returned — Source Bridge is reviewing";
    default:
      return null;
  }
}

function amountLine(
  label: string,
  minor: unknown,
  currency: string,
): PurchaseAmountLine | null {
  if (typeof minor !== "number" || !Number.isInteger(minor) || minor < 0) return null;
  return { label, text: formatMinor(minor, currency) };
}

export function purchaseCardModel(order: PurchaseCardInput): PurchaseCardModel {
  const currency = order.currency || "USD";
  const status = String(order.status || "");
  const seller = order.counterparty?.username
    ? `@${order.counterparty.username}`
    : order.counterparty?.name || "—";
  const lines = [
    amountLine("Item", order.itemCostMinor, currency),
    amountLine("Shipping", order.shippingMinor, currency),
    amountLine("Sourcer fee", order.sellerServiceFeeMinor, currency),
    amountLine("Source Bridge fee", order.protectionFeeMinor, currency),
  ].filter((line): line is PurchaseAmountLine => Boolean(line));
  const payoutPhrase =
    order.payoutRail === "STRIPE_GLOBAL_PAYOUTS"
      ? purchasePayoutPhrase(order.globalPayouts?.phase)
      : null;
  const payoutLabel =
    order.payoutRail === "STRIPE_GLOBAL_PAYOUTS"
      ? payoutPhrase
        ? `Global Payouts — ${payoutPhrase}`
        : "Global Payouts"
      : null;
  const quoteKind = purchaseQuoteReviewKind(order);
  const offersRelease =
    Boolean(order.actions?.canReleaseProcurement) ||
    (status === "DELIVERED" && Boolean(order.actions?.canReleaseNow)) ||
    (status === "IN_INSPECTION" && Boolean(order.actions?.canReleaseNow));
  return {
    seller,
    title: order.title || "Purchase",
    statusLabel:
      order.displayState?.label || status.replace(/_/g, " ") || "Purchase",
    totalText:
      typeof order.totalChargeMinor === "number"
        ? formatMinor(order.totalChargeMinor, currency)
        : "—",
    lines,
    payoutLabel,
    quoteKind,
    offersRelease,
    offersQuoteConfirmation: quoteKind !== null,
  };
}
