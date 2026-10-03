import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { reviewGlobalPayoutQuote } from "@/lib/payments/payout-rail/quote-review";

export const runtime = "nodejs";

const schema = z.object({
  protectedTxnId: z.string().trim().min(1),
  kind: z.enum(["FINAL", "PROCUREMENT"]).default("FINAL"),
  action: z.enum(["status", "prepare", "confirm"]),
  quoteId: z.string().trim().min(1).optional(),
});

/**
 * Authorized buyer reviews a Global Payouts estimate before release.
 * prepare may create a quote. confirm stores that same quote. Neither creates an OutboundPayment.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    if (parsed.data.action === "confirm" && !parsed.data.quoteId) {
      return jsonError("Quote confirmation requires the reviewed quote.", 400, {
        code: "GP_QUOTE_REVIEW_REQUIRED",
      });
    }
    const result = await reviewGlobalPayoutQuote({
      actorUserId: user.id,
      protectedTxnId: parsed.data.protectedTxnId,
      kind: parsed.data.kind,
      action: parsed.data.action,
      quoteId: parsed.data.quoteId,
    });
    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404 : result.code === "GP_QUOTE_ACTOR_MISMATCH" ? 403 : 409;
      return jsonError("Payout estimate could not be confirmed.", status, {
        code: result.code,
        review: result.review ?? null,
      });
    }
    return Response.json(
      { ok: true, review: result.review },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[payments:gp-quote-review]", err);
    return jsonError("Payout estimate could not be prepared.", 500);
  }
}
