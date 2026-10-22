import { requireAdmin } from "@/lib/auth";
import { isPlatformBalanceReadinessEnabled } from "@/lib/payments/flags";
import { runReadOnlyPlatformReadiness } from "@/lib/payments/payout-rail/platform-balance-readiness";
import { PLATFORM_PAYOUT_SCHEDULE_ISOLATION } from "@/lib/payments/payout-rail/platform-balance";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Isolated TEST readiness read. Does not release inspections, create quotes,
 * or create payouts. LIVE readiness is not called from this route.
 */
export async function GET() {
  try {
    await requireAdmin();
    if (!isPlatformBalanceReadinessEnabled("TEST")) {
      return jsonError("TEST readiness is off", 409);
    }
    const report = await runReadOnlyPlatformReadiness("TEST");
    return Response.json({
      ok: true,
      mode: "TEST" as const,
      payoutScheduleIsolation: PLATFORM_PAYOUT_SCHEDULE_ISOLATION,
      ready: report.ready,
      payoutsAllowed: false as const,
      moneyMovementEnabled: report.moneyMovementEnabled,
      quotesCreated: report.quotesCreated,
      payoutsCreated: report.payoutsCreated,
      webhooks: report.webhooks,
      balance: report.balance,
      outstandingConnect: report.outstandingConnect,
      currencies: report.currencies.map((row) => ({
        currency: row.currency,
        ready: row.ready,
        payoutsAllowed: row.payoutsAllowed,
        code: row.code,
        scheduleInterval: row.scheduleInterval,
        destinationReady: row.destinationReady,
        destinationCode: row.destinationCode,
        defaultDestinationRouting: row.defaultDestinationRouting,
        bankConfigurationVerified: row.bankConfigurationVerified,
        bankInformation: row.bankInformation,
        dashboardConfirmation: row.dashboardConfirmation,
        accountSuffix: row.accountSuffix,
        accountHash8: row.accountHash8,
        liabilitiesReadable: row.liabilitiesReadable,
        fundedPurchaseCount: row.fundedPurchaseCount,
        scanComplete: row.scanComplete,
        recordedNets: row.recordedNets,
        reads: row.reads,
      })),
    });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    if (status === 401) return jsonError("Unauthorized", 401);
    if (status === 403) return jsonError("Admin only", 403);
    console.error("[platform-balance-readiness]", err instanceof Error ? err.name : "error");
    return jsonError("Readiness read failed", 500);
  }
}
