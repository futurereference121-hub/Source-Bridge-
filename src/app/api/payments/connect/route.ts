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
import { getAppUrlFromRequest } from "@/lib/app-url";
import {
  needsPayoutCountrySelection,
  normalizePayoutCountryCode,
} from "@/lib/payments/payout-rail/payout-country";
import { resolvePayoutRail } from "@/lib/payments/payout-rail/rail-resolver";
import { getGlobalPayoutStatus } from "@/lib/payments/payout-rail/recipient";

export const runtime = "nodejs";

function appBaseUrl(req: NextRequest): string {
  return getAppUrlFromRequest(req);
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    const status = await getConnectStatus(user.id);
    const full = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, country: true },
    });
    const gp = await getGlobalPayoutStatus(user.id);
    const allowlist = paymentsAllowlistGateSnapshot(
      full || { id: user.id, email: user.email },
    );
    const country = normalizePayoutCountryCode(full?.country) || "";
    return Response.json({
      ok: true,
      flags: paymentFlagsSnapshot(),
      paymentsAccess: allowlist,
      connect: status,
      country,
      needsPayoutCountry: needsPayoutCountrySelection({
        country: full?.country,
        connectHasAccount: status.hasAccount,
        gpHasRecipient: gp.hasRecipient,
      }),
    }, {
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
        Vary: "Cookie",
      },
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

    // onboard (default) — preserve in-progress Connect; gate only new creates.
    const existing = await getConnectStatus(user.id);
    if (!existing.hasAccount) {
      const country = normalizePayoutCountryCode(full.country);
      if (!country) {
        return Response.json(
          {
            ok: false,
            error: "Select where you will receive payouts before continuing.",
            code: "PAYOUT_COUNTRY_REQUIRED",
          },
          { status: 400 },
        );
      }
      const rail = await resolvePayoutRail({
        userId: user.id,
        email: full.email,
        country,
      });
      if (rail.rail === "UNSUPPORTED") {
        return Response.json(
          {
            ok: false,
            error: "Payouts are not yet available in your location.",
            code: "PAYOUTS_UNAVAILABLE",
          },
          { status: 409 },
        );
      }
      if (rail.rail !== "STRIPE_CONNECT") {
        return Response.json(
          {
            ok: false,
            error: "Payout setup for your location uses a different path. Refresh and try again.",
            code: "PAYOUT_RAIL_MISMATCH",
          },
          { status: 409 },
        );
      }
      const link = await createConnectOnboardingLink({
        userId: user.id,
        email: full.email,
        country,
        returnUrl: `${base}/profile/settings/payments?connect=return`,
        refreshUrl: `${base}/profile/settings/payments?connect=refresh`,
      });
      return Response.json({
        ok: true,
        url: link.url,
        stripeAccountId: link.stripeAccountId,
      });
    }

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
