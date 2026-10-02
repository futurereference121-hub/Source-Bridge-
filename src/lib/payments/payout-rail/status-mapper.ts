/**
 * Map Stripe Global Payouts provider statuses → local OutboundPaymentAttempt status.
 * Monotonic: posted/succeeded wins; ignore stale pending after success.
 */

export type LocalOutboundStatus =
  | "PENDING"
  | "AWAITING_MINIMUM"
  | "AWAITING_FA_FUNDS"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "RETURNED"
  | "RECONCILED"
  | "ACTION_REQUIRED";

const RANK: Record<LocalOutboundStatus, number> = {
  PENDING: 0,
  AWAITING_MINIMUM: 1,
  AWAITING_FA_FUNDS: 1,
  PROCESSING: 2,
  ACTION_REQUIRED: 3,
  FAILED: 4,
  RETURNED: 5,
  SUCCEEDED: 6,
  RECONCILED: 7,
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

/** Stripe holds the payment in processing with status_details.processing.reason = under_review. */
export function outboundPaymentIsUnderReview(
  body: Record<string, unknown> | null | undefined,
): boolean {
  const details = asRecord(body?.status_details);
  const processing = asRecord(details?.processing);
  return String(processing?.reason || "").toLowerCase() === "under_review";
}

export function isUnderReviewOutboundEvent(eventType: string): boolean {
  return String(eventType || "").toLowerCase().includes("under_review");
}

export function underReviewBlocksFinalization(opts: {
  failureCode?: string | null;
  providerUnderReview: boolean;
}): boolean {
  return opts.providerUnderReview || opts.failureCode === "GP_UNDER_REVIEW";
}

export function mapOutboundPaymentProviderStatus(
  body: Record<string, unknown> | null | undefined,
): LocalOutboundStatus {
  if (!body) return "PROCESSING";
  if (outboundPaymentIsUnderReview(body)) return "PROCESSING";
  const raw = String(
    body.status || body.state || body.outcome || "",
  ).toLowerCase();
  if (
    raw === "posted" ||
    raw === "succeeded" ||
    raw === "paid" ||
    raw === "completed"
  ) {
    return "SUCCEEDED";
  }
  if (raw === "returned" || raw === "reversed") return "RETURNED";
  if (raw === "failed" || raw === "canceled" || raw === "cancelled") {
    return "FAILED";
  }
  if (
    raw === "requires_action" ||
    raw === "action_required" ||
    raw.includes("action")
  ) {
    return "ACTION_REQUIRED";
  }
  return "PROCESSING";
}

export function canAdvanceOutboundStatus(
  current: string,
  next: LocalOutboundStatus,
): boolean {
  const cur = (RANK[current as LocalOutboundStatus] ?? 0);
  const nxt = RANK[next] ?? 0;
  // Allow FAILED → retry PENDING externally; otherwise monotonic.
  if (current === "FAILED" || current === "AWAITING_MINIMUM" || current === "AWAITING_FA_FUNDS") {
    return true;
  }
  if (current === "SUCCEEDED" || current === "RECONCILED") {
    return next === "RETURNED" || next === "RECONCILED";
  }
  if (current === "RETURNED" || current === "FAILED") {
    return next === current;
  }
  return nxt >= cur;
}

/**
 * Pinned API 2026-08-26.preview keeps status as processing | failed | posted |
 * returned | canceled. under_review is status_details.processing.reason, added
 * in 2026-06-24 and present because this version's status_details covers
 * processing as well as failed and returned. It is not a new top-level status.
 */
export function decideOutboundEventTransition(opts: {
  currentStatus: string;
  failureCode: string;
  eventType: string;
  providerUnderReview?: boolean;
}): {
  changed: boolean;
  finalize: boolean;
  status: string;
  failureCode: string;
} {
  const current = opts.currentStatus;
  const kept = {
    changed: false,
    finalize: false,
    status: current,
    failureCode: opts.failureCode,
  };
  const settled =
    current === "SUCCEEDED" ||
    current === "RECONCILED" ||
    current === "RETURNED" ||
    current === "FAILED";

  if (isUnderReviewOutboundEvent(opts.eventType) || opts.providerUnderReview) {
    if (settled) return kept;
    return {
      changed: current !== "PROCESSING" || opts.failureCode !== "GP_UNDER_REVIEW",
      finalize: false,
      status: "PROCESSING",
      failureCode: "GP_UNDER_REVIEW",
    };
  }

  const mapped = mapThinOutboundEventType(opts.eventType);
  if (!mapped) return kept;

  if (mapped === "SUCCEEDED") {
    if (settled) return kept;
    return { changed: true, finalize: true, status: "SUCCEEDED", failureCode: "" };
  }
  if (mapped === "RETURNED") {
    if (current === "RETURNED") return kept;
    return { changed: true, finalize: false, status: "RETURNED", failureCode: "RETURNED" };
  }
  if (mapped === "FAILED" || mapped === "ACTION_REQUIRED") {
    if (current === "SUCCEEDED" || current === "RECONCILED" || current === "RETURNED") return kept;
    return { changed: true, finalize: false, status: mapped, failureCode: mapped };
  }
  if (mapped === "PROCESSING") {
    if (opts.failureCode === "GP_UNDER_REVIEW" || settled) return kept;
    return {
      changed: current !== "PROCESSING",
      finalize: false,
      status: "PROCESSING",
      failureCode: opts.failureCode,
    };
  }
  return kept;
}

export function mapThinOutboundEventType(eventType: string): LocalOutboundStatus | null {
  const t = eventType.toLowerCase();
  if (t.includes("under_review")) return "PROCESSING";
  if (t.includes("posted") || t.includes("succeeded")) return "SUCCEEDED";
  if (t.includes("returned")) return "RETURNED";
  if (t.includes("failed") || t.includes("canceled") || t.includes("cancelled")) {
    return "FAILED";
  }
  if (t.includes("action_required") || t.includes("requires_action")) {
    return "ACTION_REQUIRED";
  }
  if (t.includes("created") || t.includes("processing") || t.includes("pending")) {
    return "PROCESSING";
  }
  return null;
}
