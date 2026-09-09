import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { listMarketplaceOpportunities } from "@/lib/opportunities/feed";
import { opportunityMarketplaceQuerySchema } from "@/lib/opportunities/validation";

export const dynamic = "force-dynamic";

/**
 * Cursor-paginated Opportunities marketplace (For You / Latest).
 * Network-only via SW /api/ rule. No offline cache of private drafts.
 */
export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const raw = {
      mode: url.searchParams.get("mode") || "latest",
      cursor: url.searchParams.get("cursor") || undefined,
      limit: url.searchParams.get("limit") || "20",
      kind: url.searchParams.get("kind") || "ALL",
      country: url.searchParams.get("country") || undefined,
      city: url.searchParams.get("city") || undefined,
      category: url.searchParams.get("category") || undefined,
      deliveryCountry: url.searchParams.get("deliveryCountry") || undefined,
      deliveryCity: url.searchParams.get("deliveryCity") || undefined,
      openOnly: url.searchParams.get("openOnly") || undefined,
      deadlineFrom: url.searchParams.get("deadlineFrom") || undefined,
      deadlineTo: url.searchParams.get("deadlineTo") || undefined,
    };
    const parsed = opportunityMarketplaceQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid query", 400);
    }

    const viewer = await getSessionUser().catch(() => null);
    const openOnly =
      raw.openOnly === "1" ||
      raw.openOnly === "true" ||
      parsed.data.openOnly === "1" ||
      parsed.data.openOnly === "true";

    const result = await listMarketplaceOpportunities({
      mode: parsed.data.mode,
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
      kind: parsed.data.kind,
      country: parsed.data.country,
      city: parsed.data.city,
      category: parsed.data.category,
      deliveryCountry: parsed.data.deliveryCountry,
      deliveryCity: parsed.data.deliveryCity,
      openOnly,
      deadlineFrom: parsed.data.deadlineFrom
        ? new Date(parsed.data.deadlineFrom)
        : null,
      deadlineTo: parsed.data.deadlineTo
        ? new Date(parsed.data.deadlineTo)
        : null,
      viewerId: viewer?.id ?? null,
    });

    return Response.json({
      items: result.items,
      nextCursor: result.nextCursor,
      mode: parsed.data.mode,
    });
  } catch (err) {
    console.error("[opportunities:marketplace]", err);
    return jsonError("Failed to load opportunities", 500);
  }
}
