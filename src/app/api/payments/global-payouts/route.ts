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
import { getAppUrlFromRequest } from "@/lib/app-url";
import {
  needsPayoutCountrySelection,
  normalizePayoutCountryCode,
} from "@/lib/payments/payout-rail/payout-country";
import { getSellerConnectFundingState } from "@/lib/payments/stripe/connect";

export const runtime = "nodejs";

function appBaseUrl(req: NextRequest): string {
  return getAppUrlFromRequest(req);
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    const [status, rail, connect] = await Promise.all([
      getGlobalPayoutStatus(user.id),
      resolvePayoutRail({ userId: user.id, email: user.email }),
      getSellerConnectFundingState(user.id),
    ]);
    const full = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, country: true },
    });
    const allowlist = paymentsAllowlistGateSnapshot(
      full || { id: user.id, email: user.email },
    );
    const country = normalizePayoutCountryCode(full?.country) || "";
    const needsCountry = needsPayoutCountrySelection({
      country: full?.country,
      connectHasAccount: connect.hasAccount,
      gpHasRecipient: status.hasRecipient,
    });
    return Response.json(
      {
        ok: true,
        flags: paymentFlagsSnapshot(),
        paymentsAccess: allowlist,
        globalPayouts: status,
        needsPayoutCountry: needsCountry,
        country,
        rail: {
          rail: rail.rail,
          reason: rail.reason,
          payoutReady: rail.payoutReady,
          country: rail.country || country,
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

    const status = await getGlobalPayoutStatus(user.id);
    const country = normalizePayoutCountryCode(full.country);
    if (!status.hasRecipient) {
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
      if (rail.rail !== "STRIPE_GLOBAL_PAYOUTS") {
        return Response.json(
          {
            ok: false,
            error:
              "Payout setup for your location uses a different path. Refresh and try again.",
            code: "PAYOUT_RAIL_MISMATCH",
          },
          { status: 409 },
        );
      }
    }

    const link = await createGlobalPayoutOnboardingLink({
      userId: user.id,
      email: full.email,
      country: country || full.country || "",
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
