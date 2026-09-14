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

export function mapOutboundPaymentProviderStatus(
  body: Record<string, unknown> | null | undefined,
): LocalOutboundStatus {
  if (!body) return "PROCESSING";
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
  return nxt >= cur;
}

export function mapThinOutboundEventType(eventType: string): LocalOutboundStatus | null {
  const t = eventType.toLowerCase();
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
