import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/validation";
import { paymentFlagsSnapshot } from "@/lib/payments/flags";
import { getPlatformPaymentConfig } from "@/lib/payments/config";
import { CHARGE_MODEL, isStripeConfigured } from "@/lib/payments/stripe/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();

    const [
      funded,
      inFlight,
      disputed,
      released,
      failedTransfers,
      openDisputes,
      config,
    ] = await Promise.all([
      prisma.protectedTransaction.count({ where: { status: "FUNDED" } }),
      prisma.protectedTransaction.count({
        where: {
          status: {
            in: [
              "PROCUREMENT_RELEASED",
              "AWAITING_SHIPMENT",
              "IN_TRANSIT",
              "DELIVERED",
              "IN_INSPECTION",
              "READY_TO_RELEASE",
            ],
          },
        },
      }),
      prisma.protectedTransaction.count({ where: { status: "DISPUTED" } }),
      prisma.protectedTransaction.count({ where: { status: "RELEASED" } }),
      prisma.transferAttempt.count({ where: { status: "FAILED" } }),
      prisma.disputeCase.count({ where: { status: "OPEN" } }),
      getPlatformPaymentConfig(),
    ]);

    const recent = await prisma.protectedTransaction.findMany({
      take: 20,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        status: true,
        paymentOption: true,
        currency: true,
        totalChargeMinor: true,
        stripeMode: true,
        buyerId: true,
        sellerId: true,
        fundedAt: true,
        releasedAt: true,
        updatedAt: true,
      },
    });

    return Response.json({
      ok: true,
      flags: paymentFlagsSnapshot(),
      chargeModel: CHARGE_MODEL,
      stripeConfigured: isStripeConfigured(),
      config,
      stats: {
        funded,
        inFlight,
        disputed,
        released,
        failedTransfers,
        openDisputes,
      },
      recent,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 403) return jsonError("Admin only", 403);
    console.error("[admin:payments]", err);
    return jsonError("Failed to load financial dashboard", 500);
  }
}
