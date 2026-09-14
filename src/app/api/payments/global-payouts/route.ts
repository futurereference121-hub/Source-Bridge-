import { NextRequest } from "next/server";
import { requireSessionUser, isAdminUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { paymentFlagsSnapshot } from "@/lib/payments/flags";
import { paymentsAllowlistGateSnapshot } from "@/lib/payments/allowlist";
import { assertEligiblePaymentParty } from "@/lib/payments/eligibility";
import { prisma } from "@/lib/db";
import {
  createGlobalPayoutOnboardingLink,
  getGlobalPayoutStatus,
  syncGlobalPayoutRecipient,
} from "@/lib/payments/payout-rail/recipient";
import { resolvePayoutRail } from "@/lib/payments/payout-rail/rail-resolver";

export const runtime = "nodejs";

function appBaseUrl(req: NextRequest): string {
  const env = (process.env.APP_URL || "").replace(/\/$/, "");
  if (env) return env;
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    const [status, rail] = await Promise.all([
      getGlobalPayoutStatus(user.id),
      resolvePayoutRail({ userId: user.id, email: user.email }),
    ]);
    const full = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, country: true },
    });
    const allowlist = paymentsAllowlistGateSnapshot(
      full || { id: user.id, email: user.email },
    );
    return Response.json(
      {
        ok: true,
        flags: paymentFlagsSnapshot(),
        paymentsAccess: allowlist,
        globalPayouts: status,
        rail: {
          rail: rail.rail,
          reason: rail.reason,
          payoutReady: rail.payoutReady,
          country: rail.country || full?.country || "",
        },
      },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
          Vary: "Cookie",
        },
      },
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[payments:global-payouts:get]", err);
    return jsonError("Failed to load payout status", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (isAdminUser(user)) {
      return jsonError("Admin accounts cannot onboard for seller payouts", 403);
    }

    const full = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        country: true,
        isDemo: true,
        isTestAccount: true,
        isAdmin: true,
        role: true,
        username: true,
        deletedAt: true,
        trustLevel: true,
        procurementAdvancesEnabled: true,
        identityVerified: true,
      },
    });
    assertEligiblePaymentParty(full, "seller");

    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      recipientType?: "individual" | "company";
    };
    const action = body.action || "onboard";
    const base = appBaseUrl(req);

    if (action === "sync") {
      const row = await syncGlobalPayoutRecipient(user.id);
      return Response.json({
        ok: true,
        globalPayouts: await getGlobalPayoutStatus(user.id),
        synced: Boolean(row),
      });
    }

    const link = await createGlobalPayoutOnboardingLink({
      userId: user.id,
      email: full.email,
      country: full.country,
      recipientType: body.recipientType === "company" ? "company" : "individual",
      returnUrl: `${base}/profile/settings/payments?gp=return`,
      refreshUrl: `${base}/profile/settings/payments?gp=refresh`,
    });

    return Response.json({ ok: true, url: link.url, recipientId: link.recipientId });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const code = (err as { code?: string }).code;
    const message =
      err instanceof Error ? err.message : "Failed to start payout setup";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) {
      return Response.json({ ok: false, error: message, code }, { status });
    }
    console.error("[payments:global-payouts:post]", err);
    return jsonError(message, 500);
  }
}
