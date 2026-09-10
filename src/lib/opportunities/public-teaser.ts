/**
 * Public Opportunity teaser projection — compact list/feed only.
 * Budget, notes, and other full-detail fields must not leave the server
 * for logged-out (or list) payloads. Authenticated GET /api/opportunities/:id
 * remains the full-detail boundary.
 */

import type { FeedItem } from "@/lib/types";
import type { OpportunityPublic } from "@/lib/opportunities/map";

/** Same-origin return path for auth → Opportunity detail (no open redirects). */
export function safeOpportunityReturnPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/explore";
  if (raw === "/admin" || raw.startsWith("/admin/")) return "/explore";
  return raw;
}

/** Canonical return URL that re-opens a specific Opportunity after sign-in. */
export function opportunityAuthReturnPath(
  opportunityId: string,
  currentPath?: string | null,
): string {
  const id = opportunityId.trim();
  if (!id) return safeOpportunityReturnPath(currentPath);
  if (currentPath && currentPath.startsWith("/") && !currentPath.startsWith("//")) {
    try {
      const url = new URL(currentPath, "https://sourcebridge.local");
      if (url.pathname.startsWith("/admin")) {
        return `/opportunities?id=${encodeURIComponent(id)}`;
      }
      url.searchParams.set("id", id);
      const qs = url.searchParams.toString();
      return qs ? `${url.pathname}?${qs}` : `${url.pathname}?id=${encodeURIComponent(id)}`;
    } catch {
      /* fall through */
    }
  }
  return `/opportunities?id=${encodeURIComponent(id)}`;
}

export function mapOpportunitySummary(pub: OpportunityPublic): OpportunityPublic {
  return {
    ...pub,
    // Teaser keeps title; omit long-form / private detail fields.
    description: pub.title || pub.summary || "",
    budgetMinMinor: null,
    budgetMaxMinor: null,
    budgetCurrency: "",
    notes: "",
    specialistDetails: "",
    sizeLimits: "",
    luggageRestrictions: "",
    alternativesOk: null,
  };
}

export function sanitizeOpportunityFeedItem(item: FeedItem): FeedItem {
  if (item.kind !== "opportunity") return item;
  const rest = { ...item };
  delete rest.budgetMinMinor;
  delete rest.budgetMaxMinor;
  delete rest.budgetCurrency;
  return rest;
}

export function sanitizeOpportunityFeedItems(items: FeedItem[]): FeedItem[] {
  return items.map(sanitizeOpportunityFeedItem);
}
