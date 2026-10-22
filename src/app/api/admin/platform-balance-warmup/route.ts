import { requireAdmin } from "@/lib/auth";
import { PLATFORM_PAYOUT_SCHEDULE_ISOLATION } from "@/lib/payments/payout-rail/platform-balance";
import { runPlatformBalanceWarmup } from "@/lib/payments/payout-rail/platform-balance-warmup";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Dedicated TEST+LIVE coordination warmup. Does not enable funding or remainder
 * flags, create payouts, or change the Stripe payout schedule.
 */
export async function POST() {
  try {
    await requireAdmin();
    const [test, live] = await Promise.all([
      runPlatformBalanceWarmup("TEST"),
      runPlatformBalanceWarmup("LIVE"),
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
    console.error("[platform-balance-warmup]", err instanceof Error ? err.name : "error");
    return jsonError("Warmup failed", 500);
  }
}
