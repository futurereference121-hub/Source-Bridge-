import { NextRequest } from "next/server";
import { requireSessionUser, isAdminUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { prisma } from "@/lib/db";
import { getSellerConnectFundingState } from "@/lib/payments/stripe/connect";
import { getGlobalPayoutStatus } from "@/lib/payments/payout-rail/recipient";
import { resolvePayoutRail } from "@/lib/payments/payout-rail/rail-resolver";
import { buildPayoutRouteConfirmation } from "@/lib/payments/payout-rail/payout-route-confirm";
import {
  getSupportedPayoutCountryOptions,
  isSupportedPayoutCountry,
  needsPayoutCountrySelection,
  normalizePayoutCountryCode,
  payoutCountryChangeBlocked,
} from "@/lib/payments/payout-rail/payout-country";

export const runtime = "nodejs";

const NO_STORE = {
  headers: {
    "Cache-Control": "private, no-store, no-cache, must-revalidate",
    Vary: "Cookie",
  },
} as const;

function incompleteOnboarding(opts: {
  connectHasAccount: boolean;
  connectReady: boolean;
  gpHasRecipient: boolean;
  gpReady: boolean;
}): boolean {
  if (opts.connectHasAccount && !opts.connectReady) return true;
  if (opts.gpHasRecipient && !opts.gpReady) return true;
  return false;
}

/**
 * GET — current payout country, supported selector options, and route confirmation
 * metadata when a country is already set. Never creates Stripe objects.
 * Optional ?country=XX previews confirmation for a candidate country without saving.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const full = await prisma.user.findUnique({
      where: { id: user.id },
      select: { country: true, email: true },
    });
    const [connect, gp] = await Promise.all([
      getSellerConnectFundingState(user.id),
      getGlobalPayoutStatus(user.id),
    ]);
    const storedCountry = normalizePayoutCountryCode(full?.country) || "";
    const previewRaw = req.nextUrl.searchParams.get("country");
    const previewCountry = previewRaw
      ? normalizePayoutCountryCode(previewRaw)
      : null;
    const countryForRail = previewCountry || storedCountry || null;

    const rail = await resolvePayoutRail({
      userId: user.id,
      email: user.email,
      country: countryForRail || undefined,
    });

    const needsCountry = needsPayoutCountrySelection({
      country: full?.country,
      connectHasAccount: connect.hasAccount,
      gpHasRecipient: gp.hasRecipient,
    });

    const confirmation =
      countryForRail && (rail.country || countryForRail)
        ? buildPayoutRouteConfirmation(
            { ...rail, country: rail.country || countryForRail },
            {
              incompleteOnboarding: incompleteOnboarding({
                connectHasAccount: connect.hasAccount,
                connectReady: connect.ready,
                gpHasRecipient: gp.hasRecipient,
                gpReady: gp.payoutReady,
              }),
            },
          )
        : null;

    return Response.json(
      {
        ok: true,
        country: storedCountry,
        needsPayoutCountry: needsCountry,
        countries: getSupportedPayoutCountryOptions(),
        countryLocked: Boolean(connect.hasAccount || gp.hasRecipient),
        preview: Boolean(previewCountry),
        rail: {
          rail: rail.rail,
          reason: rail.reason,
          payoutReady: rail.payoutReady,
          country: rail.country || storedCountry,
        },
        confirmation,
        stripeAccountCreated: false,
        recipientCreated: false,
        outboundPaymentCreated: false,
      },
      NO_STORE,
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[payments:payout-country:get]", err);
    return jsonError("Failed to load payout country", 500);
  }
}

/**
 * POST — save normalized ISO country OR preview route confirmation without saving.
 * Never creates Stripe Connect accounts, GP recipients, or OutboundPayments.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (isAdminUser(user)) {
      return jsonError("Admin accounts cannot onboard for seller payouts", 403);
    }

    const body = (await req.json().catch(() => ({}))) as {
      country?: string;
      preview?: boolean;
    };
    const country = normalizePayoutCountryCode(body.country);
    if (!country || !isSupportedPayoutCountry(country)) {
      return Response.json(
        {
          ok: false,
          error: "Select a valid country.",
          code: "INVALID_PAYOUT_COUNTRY",
        },
        { status: 400 },
      );
    }

    const [connect, gpBefore, full] = await Promise.all([
      getSellerConnectFundingState(user.id),
      getGlobalPayoutStatus(user.id),
      prisma.user.findUnique({
        where: { id: user.id },
        select: { country: true, email: true },
      }),
    ]);

    const previewOnly = Boolean(body.preview);
    if (!previewOnly) {
      const lock = payoutCountryChangeBlocked({
        existingCountry: full?.country,
        nextCountry: country,
        connectHasAccount: connect.hasAccount,
        gpHasRecipient: gpBefore.hasRecipient,
      });
      if (lock.blocked) {
        return Response.json(
          {
            ok: false,
            error: lock.message || "Payout country cannot be changed.",
            code: "PAYOUT_COUNTRY_LOCKED",
          },
          { status: 409 },
        );
      }

      // Persist ISO code only. Established Connect / GP recipients keep their rail
      // via resolvePayoutRail priority — country edits never force a silent switch.
      await prisma.user.update({
        where: { id: user.id },
        data: { country },
      });
    }

    const rail = await resolvePayoutRail({
      userId: user.id,
      email: user.email,
      country,
    });

    const confirmation = buildPayoutRouteConfirmation(
      { ...rail, country: rail.country || country },
      {
        incompleteOnboarding: incompleteOnboarding({
          connectHasAccount: connect.hasAccount,
          connectReady: connect.ready,
          gpHasRecipient: gpBefore.hasRecipient,
          gpReady: gpBefore.payoutReady,
        }),
      },
    );

    return Response.json({
      ok: true,
      country: previewOnly
        ? normalizePayoutCountryCode(full?.country) || ""
        : country,
      preview: previewOnly,
      needsPayoutCountry: needsPayoutCountrySelection({
        country: previewOnly ? full?.country : country,
        connectHasAccount: connect.hasAccount,
        gpHasRecipient: gpBefore.hasRecipient,
      }),
      countries: getSupportedPayoutCountryOptions(),
      countryLocked: Boolean(connect.hasAccount || gpBefore.hasRecipient),
      rail: {
        rail: rail.rail,
        reason: rail.reason,
        payoutReady: rail.payoutReady,
        country: rail.country || country,
      },
      confirmation,
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
