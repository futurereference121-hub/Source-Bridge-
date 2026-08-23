/**
 * Human-facing Source Bridge review / dispute context copy.
 * Raw dispute/txn/ticket IDs belong only in Advanced/Audit UI.
 */

export type DisputeContextStructured = {
  title: string;
  issueSummary: string;
  statusLabel: string;
  buyerHandle: string;
  sellerHandle: string;
  createdAtIso: string;
  reviewHref: string;
  /** Audit-only identifiers — never primary copy. */
  disputeCaseId?: string | null;
  protectedTxnId?: string | null;
  paymentTicketId?: string | null;
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

export function buildDisputeContextStructured(opts: {
  title: string;
  category?: string | null;
  reason?: string | null;
  status?: string | null;
  buyerUsername?: string | null;
  sellerUsername?: string | null;
  createdAt: Date | string;
  reviewHref: string;
  disputeCaseId?: string | null;
  protectedTxnId?: string | null;
  paymentTicketId?: string | null;
}): DisputeContextStructured {
  const issue =
    (opts.category || "").trim() ||
    (opts.reason || "").trim() ||
    "Item issue reported";
  const createdAtIso =
    opts.createdAt instanceof Date
      ? opts.createdAt.toISOString()
      : String(opts.createdAt);
  return {
    title: (opts.title || "").trim() || "Protected payment",
    issueSummary: issue.slice(0, 200),
    statusLabel: formatDisputeStatusLabel(opts.status),
    buyerHandle: handleize(opts.buyerUsername, "@buyer"),
    sellerHandle: handleize(opts.sellerUsername, "@sourcer"),
    createdAtIso,
    reviewHref: opts.reviewHref,
    disputeCaseId: opts.disputeCaseId ?? null,
    protectedTxnId: opts.protectedTxnId ?? null,
    paymentTicketId: opts.paymentTicketId ?? null,
  };
}

/** Persist a human body — no raw cuid/uuid IDs. */
export function formatHumanDisputeContextBody(
  data: DisputeContextStructured,
): string {
  const date = formatDisputeDate(data.createdAtIso);
  return [
    "SOURCE BRIDGE REVIEW",
    `Item: ${data.title}`,
    `Issue: ${data.issueSummary}`,
    `Status: ${data.statusLabel}`,
    `${data.buyerHandle} · ${data.sellerHandle}`,
    `Date: ${date}`,
    "View Review",
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
 * embedded raw IDs so historical messages still render humanly.
 */
export function resolveDisputeContextDisplay(
  body: string,
  structured?: Partial<DisputeContextStructured> | null,
): DisputeContextStructured {
  const legacyTitle = body.match(LEGACY_QUOTED_TITLE)?.[1]?.trim();
  const cleanedLines = body
    .split("\n")
    .map((l) => l.replace(LEGACY_ID_LINE, "").replace(/^Dispute context\s*·?\s*/i, "").trim())
    .filter(Boolean);

  const title =
    structured?.title?.trim() ||
    legacyTitle ||
    pickLabeled(cleanedLines, "Item") ||
    "Protected payment";
  const issueSummary =
    structured?.issueSummary?.trim() ||
    pickLabeled(cleanedLines, "Issue") ||
    "Item issue reported";
  const statusLabel =
    structured?.statusLabel?.trim() ||
    pickLabeled(cleanedLines, "Status") ||
    "Under review";
  const handlesLine =
    cleanedLines.find((l) => l.includes("@")) ||
    `${structured?.buyerHandle || "@buyer"} · ${structured?.sellerHandle || "@sourcer"}`;
  const buyerHandle =
    structured?.buyerHandle ||
    handlesLine.split(/[·|,]/).map((s) => s.trim()).find((s) => s.startsWith("@")) ||
    "@buyer";
  const sellerHandle =
    structured?.sellerHandle ||
    handlesLine
      .split(/[·|,]/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("@"))[1] ||
    "@sourcer";
  const createdAtIso =
    structured?.createdAtIso ||
    new Date().toISOString();

  return {
    title,
    issueSummary,
    statusLabel,
    buyerHandle,
    sellerHandle,
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
  if (/SOURCE BRIDGE REVIEW/i.test(body)) return "SOURCE BRIDGE REVIEW";
  if (/Dispute context/i.test(body)) return "SOURCE BRIDGE REVIEW";
  return "SOURCE BRIDGE REVIEW";
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
