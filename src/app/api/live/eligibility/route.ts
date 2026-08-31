import { getSessionUser } from "@/lib/auth";
import { evaluateLiveEligibility } from "@/lib/live/eligibility";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getSessionUser();
    const eligibility = await evaluateLiveEligibility(user);
    return Response.json(eligibility, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    console.error("[live:eligibility]", err);
    return jsonError("Could not check Live eligibility", 500);
  }
}
