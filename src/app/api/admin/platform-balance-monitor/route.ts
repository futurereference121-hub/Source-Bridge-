import { requireAdmin } from "@/lib/auth";
import { PLATFORM_PAYOUT_SCHEDULE_ISOLATION } from "@/lib/payments/payout-rail/platform-balance";
import { platformBalanceMonitor } from "@/lib/payments/payout-rail/platform-balance-run";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only health of TEST and LIVE remainder workers. Does not create payouts
 * or change the Stripe payout schedule.
 */
export async function GET() {
  try {
    await requireAdmin();
    const [test, live] = await Promise.all([
      platformBalanceMonitor("TEST"),
      platformBalanceMonitor("LIVE"),
    ]);
    return Response.json({
      ok: true,
      payoutsAllowed: false as const,
      payoutScheduleIsolation: PLATFORM_PAYOUT_SCHEDULE_ISOLATION,
      TEST: test,
      LIVE: live,
    });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    if (status === 401) return jsonError("Unauthorized", 401);
    if (status === 403) return jsonError("Admin only", 403);
    console.error("[platform-balance-monitor]", err instanceof Error ? err.name : "error");
    return jsonError("Monitor read failed", 500);
  }
}
