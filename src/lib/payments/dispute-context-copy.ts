/**
 * Concise Payment Ticket issue reference for Admin↔party support chat.
 * Detailed evidence stays in Admin → Reviews — never dump it into private chat.
 */

import { formatMinor } from "@/lib/payments/money";

export type DisputeContextStructured = {
  title: string;
  statusLabel: string;
  buyerHandle: string;
  sellerHandle: string;
  amountLabel: string;
  createdAtIso: string;
  reviewHref: string;
  /** Audit-only identifiers — never primary copy / never shown in chat card. */
  disputeCaseId?: string | null;
  protectedTxnId?: string | null;
  paymentTicketId?: string | null;
  /** @deprecated Kept for legacy body parse only — not shown in new cards. */
  issueSummary?: string;
};

function handleize(username: string | null | undefined, fallback: string): string {
  const u = (username || "").trim().replace(/^@/, "");
  if (u) return `@${u}`;
  return fallback;
}

export function formatDisputeStatusLabel(status: string | null | undefined): string {
  const s = (status || "").toUpperCase();
  if (s === "OPEN" || s === "UNDER_REVIEW") return "Under review";
  if (s.startsWith("RESOLVED") || s === "CLOSED") return "Resolved";
  return s ? s.replace(/_/g, " ").toLowerCase() : "Under review";
}

export function formatDisputeAmountLabel(opts: {
  amountMinor?: number | null;
  currency?: string | null;
}): string {
  const currency = (opts.currency || "USD").trim().toUpperCase() || "USD";
  const minor =
    typeof opts.amountMinor === "number" && Number.isFinite(opts.amountMinor)
      ? Math.max(0, Math.trunc(opts.amountMinor))
      : null;
  if (minor == null) return "—";
  return formatMinor(minor, currency);
}

export function buildDisputeContextStructured(opts: {
  title: string;
  status?: string | null;
  buyerUsername?: string | null;
  sellerUsername?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  createdAt: Date | string;
  reviewHref: string;
  disputeCaseId?: string | null;
  protectedTxnId?: string | null;
  paymentTicketId?: string | null;
  /** Ignored for chat copy — evidence belongs in Admin Reviews. */
  category?: string | null;
  reason?: string | null;
}): DisputeContextStructured {
  const createdAtIso =
    opts.createdAt instanceof Date
      ? opts.createdAt.toISOString()
      : String(opts.createdAt);
  return {
    title: (opts.title || "").trim() || "Payment Ticket",
    statusLabel: formatDisputeStatusLabel(opts.status),
    buyerHandle: handleize(opts.buyerUsername, "@buyer"),
    sellerHandle: handleize(opts.sellerUsername, "@sourcer"),
    amountLabel: formatDisputeAmountLabel({
      amountMinor: opts.amountMinor,
      currency: opts.currency,
    }),
    createdAtIso,
    reviewHref: opts.reviewHref,
    disputeCaseId: opts.disputeCaseId ?? null,
    protectedTxnId: opts.protectedTxnId ?? null,
    paymentTicketId: opts.paymentTicketId ?? null,
  };
}

/** Persist a concise human body — no raw IDs, evidence, or technical dumps. */
export function formatHumanDisputeContextBody(
  data: DisputeContextStructured,
): string {
  return [
    "PAYMENT TICKET ISSUE",
    `Ticket: ${data.title}`,
    `Buyer: ${data.buyerHandle}`,
    `Sourcer: ${data.sellerHandle}`,
    `Amount: ${data.amountLabel}`,
    `Status: ${data.statusLabel}`,
  ].join("\n");
}

export function formatDisputeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const LEGACY_ID_LINE =
  /\b(?:dispute|txn|ticket)\s+[a-z0-9_-]{8,}\b/gi;
const LEGACY_QUOTED_TITLE = /"([^"]+)"/;

/**
 * Prefer structured conversation data; fall back to parsing legacy bodies that
 * embedded raw IDs or older SOURCE BRIDGE REVIEW copy.
 */
export function resolveDisputeContextDisplay(
  body: string,
  structured?: Partial<DisputeContextStructured> | null,
): DisputeContextStructured {
  const legacyTitle = body.match(LEGACY_QUOTED_TITLE)?.[1]?.trim();
  const cleanedLines = body
    .split("\n")
    .map((l) =>
      l.replace(LEGACY_ID_LINE, "").replace(/^Dispute context\s*·?\s*/i, "").trim(),
    )
    .filter(Boolean);

  const title =
    structured?.title?.trim() ||
    pickLabeled(cleanedLines, "Ticket") ||
    pickLabeled(cleanedLines, "Item") ||
    legacyTitle ||
    "Payment Ticket";
  const statusLabel =
    structured?.statusLabel?.trim() ||
    pickLabeled(cleanedLines, "Status") ||
    "Under review";
  const buyerHandle =
    structured?.buyerHandle ||
    pickLabeled(cleanedLines, "Buyer") ||
    cleanedLines
      .find((l) => l.includes("@"))
      ?.split(/[·|,]/)
      .map((s) => s.trim())
      .find((s) => s.startsWith("@")) ||
    "@buyer";
  const sellerHandle =
    structured?.sellerHandle ||
    pickLabeled(cleanedLines, "Sourcer") ||
    cleanedLines
      .find((l) => l.includes("@"))
      ?.split(/[·|,]/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("@"))[1] ||
    "@sourcer";
  const amountLabel =
    structured?.amountLabel?.trim() ||
    pickLabeled(cleanedLines, "Amount") ||
    "—";
  const createdAtIso = structured?.createdAtIso || new Date().toISOString();

  return {
    title,
    statusLabel,
    buyerHandle,
    sellerHandle,
    amountLabel,
    createdAtIso,
    reviewHref: structured?.reviewHref || "#",
    disputeCaseId: structured?.disputeCaseId ?? null,
    protectedTxnId: structured?.protectedTxnId ?? null,
    paymentTicketId: structured?.paymentTicketId ?? null,
  };
}

function pickLabeled(lines: string[], label: string): string | null {
  const prefix = `${label}:`;
  const hit = lines.find((l) => l.toLowerCase().startsWith(prefix.toLowerCase()));
  if (!hit) return null;
  return hit.slice(prefix.length).trim() || null;
}

export function disputeContextInboxPreview(body: string): string {
  if (/PAYMENT TICKET ISSUE/i.test(body)) return "PAYMENT TICKET ISSUE";
  if (/SOURCE BRIDGE REVIEW/i.test(body)) return "PAYMENT TICKET ISSUE";
  if (/Dispute context/i.test(body)) return "PAYMENT TICKET ISSUE";
  return "PAYMENT TICKET ISSUE";
}

/** Extract legacy IDs from old message bodies for Advanced/Audit only. */
export function extractLegacyDisputeIds(body: string): {
  disputeCaseId: string | null;
  protectedTxnId: string | null;
  paymentTicketId: string | null;
} {
  const dispute = body.match(/\bdispute\s+([a-z0-9_-]{8,})/i)?.[1] ?? null;
  const txn = body.match(/\btxn\s+([a-z0-9_-]{8,})/i)?.[1] ?? null;
  const ticket = body.match(/\bticket\s+([a-z0-9_-]{8,})/i)?.[1] ?? null;
  return {
    disputeCaseId: dispute,
    protectedTxnId: txn,
    paymentTicketId: ticket,
  };
}
