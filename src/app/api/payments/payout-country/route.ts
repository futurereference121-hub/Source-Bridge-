import { NextRequest } from "next/server";
import { requireSessionUser, isAdminUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { prisma } from "@/lib/db";
import { getSellerConnectFundingState } from "@/lib/payments/stripe/connect";
import { getGlobalPayoutStatus } from "@/lib/payments/payout-rail/recipient";
import { resolvePayoutRail } from "@/lib/payments/payout-rail/rail-resolver";
import {
  needsPayoutCountrySelection,
  normalizePayoutCountryCode,
  PAYOUT_COUNTRY_OPTIONS,
} from "@/lib/payments/payout-rail/payout-country";

export const runtime = "nodejs";

/**
 * GET — current payout country + whether selection is required.
 * POST — save normalized ISO country, then return resolved rail (no Stripe create).
 */
export async function GET() {
  try {
    const user = await requireSessionUser();
    const full = await prisma.user.findUnique({
      where: { id: user.id },
      select: { country: true, email: true },
    });
    const [connect, gp, rail] = await Promise.all([
      getSellerConnectFundingState(user.id),
      getGlobalPayoutStatus(user.id),
      resolvePayoutRail({ userId: user.id, email: user.email }),
    ]);
    const country = normalizePayoutCountryCode(full?.country) || "";
    const needsCountry = needsPayoutCountrySelection({
      country: full?.country,
      connectHasAccount: connect.hasAccount,
      gpHasRecipient: gp.hasRecipient,
    });
    return Response.json(
      {
        ok: true,
        country,
        needsPayoutCountry: needsCountry,
        countries: PAYOUT_COUNTRY_OPTIONS,
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
    console.error("[payments:payout-country:get]", err);
    return jsonError("Failed to load payout country", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (isAdminUser(user)) {
      return jsonError("Admin accounts cannot onboard for seller payouts", 403);
    }

    const body = (await req.json().catch(() => ({}))) as {
      country?: string;
    };
    const country = normalizePayoutCountryCode(body.country);
    if (!country) {
      return Response.json(
        {
          ok: false,
          error: "Select a valid country.",
          code: "INVALID_PAYOUT_COUNTRY",
        },
        { status: 400 },
      );
    }

    const [connect, gpBefore] = await Promise.all([
      getSellerConnectFundingState(user.id),
      getGlobalPayoutStatus(user.id),
    ]);

    // Persist ISO code only. Established Connect / GP recipients keep their rail
    // via resolvePayoutRail priority — country edits never force a silent switch.
    await prisma.user.update({
      where: { id: user.id },
      data: { country },
    });

    const rail = await resolvePayoutRail({
      userId: user.id,
      email: user.email,
      country,
    });

    return Response.json({
      ok: true,
      country,
      needsPayoutCountry: needsPayoutCountrySelection({
        country,
        connectHasAccount: connect.hasAccount,
        gpHasRecipient: gpBefore.hasRecipient,
      }),
      rail: {
        rail: rail.rail,
        reason: rail.reason,
        payoutReady: rail.payoutReady,
        country: rail.country || country,
      },
      // Explicit: this endpoint never creates Stripe objects or initiates payouts.
      stripeAccountCreated: false,
      recipientCreated: false,
      outboundPaymentCreated: false,
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message =
      err instanceof Error ? err.message : "Failed to save payout country";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[payments:payout-country:post]", err);
    return jsonError("Failed to save payout country", 500);
  }
}
