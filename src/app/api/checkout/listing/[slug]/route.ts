import { getListingBySlugAsync } from "@/lib/listings-service";
import { getMemberForListingAsync } from "@/lib/listings-service";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { checkoutPublicConfig } from "@/lib/payments/checkout";
import {
  isProtectedPaymentsEnabled,
  paymentFlagsSnapshot,
} from "@/lib/payments/flags";
import {
  listingAllowsProtected,
  parseListingPaymentOptions,
} from "@/lib/payments/listing-options";
import { getConnectStatus } from "@/lib/payments/stripe/connect";
import {
  isPaymentsTestAllowlistConfigured,
  userMatchesPaymentsAllowlist,
} from "@/lib/payments/allowlist";
import { isStripeConfigured } from "@/lib/payments/stripe/client";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Public checkout bootstrap: listing + seller's enabled crypto payment methods.
 * Supports real DB listings and seed/demo catalogue listings.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    const listing = await getListingBySlugAsync(slug);
    if (!listing) return jsonError("Listing not found", 404);

    const member = await getMemberForListingAsync(listing);
    const seller = member
      ? {
          id: member.id,
          name: member.fullName,
          username: member.username,
          slug: member.slug,
          photo: member.photo,
        }
      : {
          id: listing.memberId,
          name: "Source Bridge member",
          username: null,
          slug: null,
          photo: "",
        };

    let methods: Array<{
      id: string;
      kind: string;
      networkName: string;
      address: string;
      qrImageUrl: string;
      instructions: string;
    }> = [];

    let paymentOptions = "CONTACT_ONLY";
    let sellerConnectReady = false;
    let sellerEmail: string | null = null;

    if (listing.isDbListing) {
      methods = await prisma.sellerPaymentMethod.findMany({
        where: {
          userId: listing.memberId,
          kind: "crypto",
          enabled: true,
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          kind: true,
          networkName: true,
          address: true,
          qrImageUrl: true,
          instructions: true,
        },
      });
      const row = await prisma.stockListing.findUnique({
        where: { id: listing.id },
        select: {
          paymentOptions: true,
          user: { select: { email: true } },
        },
      });
      paymentOptions = parseListingPaymentOptions(row?.paymentOptions);
      sellerEmail = row?.user?.email ?? null;
      const connect = await getConnectStatus(listing.memberId);
      sellerConnectReady = connect.canReceiveProtectedPayments;
    }

    const stripe = checkoutPublicConfig();
    const flags = paymentFlagsSnapshot();
    const session = await getSessionUser();

    const allowlistOk =
      isPaymentsTestAllowlistConfigured() &&
      Boolean(session) &&
      userMatchesPaymentsAllowlist({
        id: session!.id,
        email: session!.email,
      }) &&
      userMatchesPaymentsAllowlist({
        id: seller.id,
        email: sellerEmail,
      });

    const listingProtectedOk =
      listingAllowsProtected(parseListingPaymentOptions(paymentOptions)) ||
      paymentOptions === "CONTACT_ONLY";

    /**
     * Stripe Payment Element path for allowlisted TEST Protected Payment.
     * Independent of the legacy "create pending order" card path.
     */
    const canStripeCardCheckout = Boolean(
      listing.isDbListing &&
        isStripeConfigured() &&
        isProtectedPaymentsEnabled() &&
        sellerConnectReady &&
        allowlistOk &&
        listingProtectedOk &&
        session &&
        session.id !== seller.id,
    );

    let cardCheckoutBlockedReason: string | null = null;
    if (listing.isDbListing && !canStripeCardCheckout) {
      if (!isStripeConfigured() || !isProtectedPaymentsEnabled()) {
        cardCheckoutBlockedReason =
          "Protected card checkout is not enabled for this environment.";
      } else if (!sellerConnectReady) {
        cardCheckoutBlockedReason =
          "Seller must complete Payments & Payouts before card checkout.";
      } else if (!isPaymentsTestAllowlistConfigured() || !allowlistOk) {
        cardCheckoutBlockedReason =
          "Card checkout is limited to approved test accounts.";
      } else if (session && session.id === seller.id) {
        cardCheckoutBlockedReason = "You cannot buy your own listing.";
      } else if (!session) {
        cardCheckoutBlockedReason = "Sign in to pay by card.";
      } else {
        cardCheckoutBlockedReason =
          "Card checkout is unavailable for this listing.";
      }
    }

    return Response.json({
      listing,
      seller,
      cryptoPaymentMethods: methods,
      paymentOptions,
      sellerConnectReady,
      canStripeCardCheckout,
      cardCheckoutBlockedReason,
      flags,
      stripeConfigured: stripe.stripeConfigured,
      stripeMode: stripe.stripeMode,
      chargeModel: stripe.chargeModel,
      isDemo: !listing.isDbListing,
      message: listing.isDbListing
        ? null
        : "Demo listing — checkout UI is available for review. Live pending transactions apply to real member listings.",
    });
  } catch (err) {
    console.error("[checkout:listing]", err);
    return jsonError("Failed to load checkout", 500);
  }
}
