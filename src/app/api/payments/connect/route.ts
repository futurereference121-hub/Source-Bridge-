import { NextRequest } from "next/server";
import { requireSessionUser, isAdminUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { paymentFlagsSnapshot } from "@/lib/payments/flags";
import { paymentsAllowlistGateSnapshot } from "@/lib/payments/allowlist";
import {
  createConnectLoginLink,
  createConnectOnboardingLink,
  getConnectStatus,
  syncConnectAccount,
} from "@/lib/payments/stripe/connect";
import { assertEligiblePaymentParty } from "@/lib/payments/eligibility";
import { prisma } from "@/lib/db";

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
    const status = await getConnectStatus(user.id);
    const full = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true },
    });
    const allowlist = paymentsAllowlistGateSnapshot(
      full || { id: user.id, email: user.email },
    );
    return Response.json({
      ok: true,
      flags: paymentFlagsSnapshot(),
      paymentsAccess: allowlist,
      connect: status,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[payments:connect:get]", err);
    return jsonError("Failed to load Connect status", 500);
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
    };
    const action = body.action || "onboard";
    const base = appBaseUrl(req);

    if (action === "sync") {
      const row = await syncConnectAccount(user.id);
      return Response.json({
        ok: true,
        connect: await getConnectStatus(user.id),
        synced: Boolean(row),
      });
    }

    if (action === "login") {
      const link = await createConnectLoginLink(user.id);
      return Response.json({ ok: true, url: link.url });
    }

    // onboard (default)
    const link = await createConnectOnboardingLink({
      userId: user.id,
      email: full.email,
      returnUrl: `${base}/profile/settings/payments?connect=return`,
      refreshUrl: `${base}/profile/settings/payments?connect=refresh`,
    });
    return Response.json({ ok: true, url: link.url, stripeAccountId: link.stripeAccountId });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message =
      err instanceof Error ? err.message : "Connect action failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[payments:connect:post]", err);
    return jsonError("Connect action failed", 500);
  }
}
