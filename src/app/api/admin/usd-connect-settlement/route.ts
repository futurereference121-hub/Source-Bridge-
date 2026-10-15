import { requireAdmin } from "@/lib/auth";
import { readUsdConnectSettlement } from "@/lib/payments/payout-rail/usd-connect-settlement-read";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin read of funded TEST Connect purchases priced in USD.
 * The server selects the purchases. The response has no account or charge ids.
 * It does not write to Stripe or the database.
 */
export async function GET() {
  try {
    await requireAdmin();
    const report = await readUsdConnectSettlement();
    return Response.json({
      ok: true,
      mode: "TEST" as const,
      writes: false as const,
      matchedCount: report.matchedCount,
      scanComplete: report.scanComplete,
      balance: report.balance,
      purchases: report.purchases,
    });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    if (status === 401) return jsonError("Unauthorized", 401);
    if (status === 403) return jsonError("Admin only", 403);
    console.error("[usd-connect-settlement]", err instanceof Error ? err.name : "error");
    return jsonError("Settlement read failed", 500);
  }
}
