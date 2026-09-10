/**
 * Safe same-origin return paths for Trust Passport auth reopen.
 * Reuses Opportunity-style open-redirect guards.
 */

import { safeOpportunityReturnPath } from "@/lib/opportunities/public-teaser";

export function safeTrustPassportReturnPath(
  raw: string | null | undefined,
): string {
  return safeOpportunityReturnPath(raw);
}

/** Canonical return URL that re-opens Trust Passport after sign-in. */
export function trustPassportAuthReturnPath(
  memberSlug: string,
  currentPath?: string | null,
): string {
  const slug = memberSlug.trim().replace(/^@/, "");
  if (!slug) return "/explore";
  const base = `/members/${encodeURIComponent(slug)}`;
  if (currentPath && currentPath.startsWith("/") && !currentPath.startsWith("//")) {
    try {
      const url = new URL(currentPath, "https://sourcebridge.local");
      if (url.pathname.startsWith("/admin")) {
        return `${base}?passport=1`;
      }
      url.searchParams.set("passport", "1");
      url.searchParams.delete("id");
      const qs = url.searchParams.toString();
      return qs ? `${url.pathname}?${qs}` : `${base}?passport=1`;
    } catch {
      /* fall through */
    }
  }
  return `${base}?passport=1`;
}
