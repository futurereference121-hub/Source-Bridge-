import { requireAdmin } from "@/lib/auth";
import { isPlatformBankRemainderPayoutEnabled } from "@/lib/payments/flags";
import {
  PLATFORM_PAYOUT_SCHEDULE_ISOLATION,
  PLATFORM_BALANCE_STALL_MS,
  dualModeManualScheduleActivation,
  readinessPassedCode,
  sharedScheduleCutover,
} from "@/lib/payments/payout-rail/platform-balance";
import { platformBalanceMonitor } from "@/lib/payments/payout-rail/platform-balance-run";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function modeReady(
  rows: Array<{ readinessCheckedAt: string | null; readinessCode: string | null }>,
): boolean {
  return rows.some((row) => Boolean(row.readinessCheckedAt) && readinessPassedCode(row.readinessCode));
}

function moneyWorkerHealthy(
  rows: Array<{ moneyWorkerCompleted: boolean; lastSuccessAt: string | null }>,
  nowMs: number,
): boolean {
  return rows.some((row) => {
    if (!row.moneyWorkerCompleted || !row.lastSuccessAt) return false;
    const successMs = Date.parse(row.lastSuccessAt);
    return Number.isFinite(successMs) && nowMs - successMs < PLATFORM_BALANCE_STALL_MS;
  });
}

/**
 * Read-only health of TEST and LIVE remainder workers. Does not create payouts
 * or change the Stripe payout schedule.
 */
export async function GET() {
  try {
    await requireAdmin();
    const now = new Date();
    const [test, live] = await Promise.all([
      platformBalanceMonitor("TEST", now),
      platformBalanceMonitor("LIVE", now),
    ]);
    const testReady = modeReady(test);
    const liveReady = modeReady(live);
    const nowMs = now.getTime();
    return Response.json({
      ok: true,
      payoutsAllowed: false as const,
      payoutScheduleIsolation: PLATFORM_PAYOUT_SCHEDULE_ISOLATION,
      sharedScheduleCutover: sharedScheduleCutover({
        test: { ready: testReady },
        live: { ready: liveReady },
        isolation: PLATFORM_PAYOUT_SCHEDULE_ISOLATION,
      }),
      manualScheduleActivation: dualModeManualScheduleActivation({
        isolation: PLATFORM_PAYOUT_SCHEDULE_ISOLATION,
        testReady,
        liveReady,
        liveBankRemainderEnabled: isPlatformBankRemainderPayoutEnabled("LIVE"),
        liveBankRemainderHealthy: moneyWorkerHealthy(live, nowMs),
      }),
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
