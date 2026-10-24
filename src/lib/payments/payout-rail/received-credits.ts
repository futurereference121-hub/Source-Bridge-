/**
 * Pinned 2026-08-26.preview ReceivedCredit reads.
 * List params are only created* / limit / page. Retrieve is by id.
 * https://docs.stripe.com/api/v2/money-management/received-credits/list?api-version=2026-08-26.preview
 */

import { gpErrorMessage, gpFetch, type GpHttpResult } from "@/lib/payments/payout-rail/gp-client";
import type { StripeMode } from "@/lib/payments/flags";

export const RECEIVED_CREDITS_LIST_PATH = "/v2/money_management/received_credits";

export function receivedCreditRetrievePath(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return "";
  return `${RECEIVED_CREDITS_LIST_PATH}/${encodeURIComponent(trimmed)}`;
}

/** Official list query. `limit` is optional; 100 is not documented as valid. */
export function receivedCreditsListPath(opts?: { limit?: number; page?: string }): string {
  const params = new URLSearchParams();
  if (typeof opts?.limit === "number" && Number.isInteger(opts.limit) && opts.limit > 0 && opts.limit <= 10) {
    params.set("limit", String(opts.limit));
  }
  if (opts?.page) params.set("page", opts.page);
  const query = params.toString();
  return query ? `${RECEIVED_CREDITS_LIST_PATH}?${query}` : RECEIVED_CREDITS_LIST_PATH;
}

function errorCode(result: GpHttpResult): string | null {
  const err = result.body?.error;
  if (!err || typeof err !== "object") return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim().slice(0, 80) : null;
}

export async function listReceivedCredits(mode: StripeMode): Promise<{
  credits: Record<string, unknown>[];
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}> {
  const credits: Record<string, unknown>[] = [];
  let path = receivedCreditsListPath();
  let httpStatus: number | null = null;
  let lastError: string | null = null;
  let lastMessage: string | null = null;
  for (let page = 0; page < 10 && path; page += 1) {
    const listed = await gpFetch({ mode, method: "GET", path });
    httpStatus = listed.status;
    if (!listed.ok) {
      lastError = errorCode(listed);
      lastMessage = gpErrorMessage(listed).slice(0, 200);
      if (page === 0 && path.includes("?")) {
        path = RECEIVED_CREDITS_LIST_PATH;
        continue;
      }
      break;
    }
    if (!Array.isArray(listed.body.data)) break;
    credits.push(...(listed.body.data as Record<string, unknown>[]));
    const next = typeof listed.body.next_page_url === "string" ? listed.body.next_page_url : "";
    path = next ? next.replace("https://api.stripe.com", "") : "";
    if (!listed.body.has_more && !next) path = "";
  }
  return { credits, httpStatus, errorCode: lastError, errorMessage: lastMessage };
}

export async function retrieveReceivedCredit(
  mode: StripeMode,
  creditId: string,
): Promise<{
  credit: Record<string, unknown> | null;
  httpStatus: number | null;
  errorCode: string | null;
}> {
  const path = receivedCreditRetrievePath(creditId);
  if (!path) return { credit: null, httpStatus: null, errorCode: "missing_id" };
  const retrieved = await gpFetch({ mode, method: "GET", path });
  if (!retrieved.ok || typeof retrieved.body.id !== "string") {
    return {
      credit: null,
      httpStatus: retrieved.status,
      errorCode: errorCode(retrieved),
    };
  }
  return { credit: retrieved.body, httpStatus: retrieved.status, errorCode: null };
}
