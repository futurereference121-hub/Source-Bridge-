import { getListingBySlugAsync } from "@/lib/listings-service";
import { getMemberForListingAsync } from "@/lib/listings-service";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { checkoutPublicConfig } from "@/lib/payments/checkout";
import {
  isDirectPaymentsEnabled,
  isProtectedPaymentsEnabled,
  paymentFlagsSnapshot,
} from "@/lib/payments/flags";
import {
  listingAllowsDirect,
  listingAllowsProtected,
  listingPaymentFlags,
  parseListingPaymentOptions,
} from "@/lib/payments/listing-options";
import { getConnectStatus } from "@/lib/payments/stripe/connect";
import {
  getPaymentsTestAllowlistEntryCount,
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
    /** Always the stock listing owner User.id when DB listing — for allowlist. */
    let sellerUserId = listing.memberId;
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
          userId: true,
          paymentOptions: true,
          user: { select: { id: true, email: true } },
        },
      });
      paymentOptions = parseListingPaymentOptions(row?.paymentOptions);
      if (row?.userId) sellerUserId = row.userId;
      if (row?.user?.id) sellerUserId = row.user.id;
      sellerEmail = row?.user?.email ?? null;
      const connect = await getConnectStatus(sellerUserId);
      sellerConnectReady = connect.canReceiveProtectedPayments;
    }

    const stripe = checkoutPublicConfig();
    const flags = paymentFlagsSnapshot();
    const session = await getSessionUser();
    const optionEnum = parseListingPaymentOptions(paymentOptions);
    const paymentFlags = listingPaymentFlags(paymentOptions);

    const allowlistConfigured = isPaymentsTestAllowlistConfigured();
    const allowlistEntryCount = getPaymentsTestAllowlistEntryCount();

    const buyerIdentity = session
      ? { id: session.id, email: session.email }
      : null;
    const sellerIdentity = {
      id: sellerUserId,
      email: sellerEmail,
    };

    const buyerAllowlisted = buyerIdentity
      ? userMatchesPaymentsAllowlist(buyerIdentity)
      : false;
    const sellerAllowlisted = listing.isDbListing
      ? userMatchesPaymentsAllowlist(sellerIdentity)
      : false;

    const allowlistOk =
      allowlistConfigured &&
      Boolean(session) &&
      buyerAllowlisted &&
      sellerAllowlisted;

    const notSelf = Boolean(session && session.id !== sellerUserId);
    const baseStripeGates =
      listing.isDbListing &&
      isStripeConfigured() &&
      sellerConnectReady &&
      allowlistOk &&
      notSelf &&
      Boolean(session);

    const listingProtectedOk = listingAllowsProtected(optionEnum);
    const listingDirectOk = listingAllowsDirect(optionEnum);

    const canProtectedCheckout = Boolean(
      baseStripeGates && isProtectedPaymentsEnabled() && listingProtectedOk,
    );
    const canDirectCheckout = Boolean(
      baseStripeGates && isDirectPaymentsEnabled() && listingDirectOk,
    );

    /** Back-compat alias for older clients (Protected card path). */
    const canStripeCardCheckout = canProtectedCheckout || canDirectCheckout;

    let cardCheckoutBlockedReason: string | null = null;
    if (listing.isDbListing && !canStripeCardCheckout) {
      if (!isStripeConfigured()) {
        cardCheckoutBlockedReason =
          "Card checkout is not enabled for this environment.";
      } else if (!isProtectedPaymentsEnabled() && !isDirectPaymentsEnabled()) {
        cardCheckoutBlockedReason =
          "Source Bridge payments are not enabled for this environment.";
      } else if (!session) {
        cardCheckoutBlockedReason = "Sign in to pay by card.";
      } else if (!sellerConnectReady) {
        cardCheckoutBlockedReason =
          "Seller must complete Payments & Payouts before card checkout.";
      } else if (!allowlistConfigured || allowlistEntryCount === 0) {
        cardCheckoutBlockedReason =
          "Card checkout test allowlist is empty on this server.";
      } else if (!buyerAllowlisted && !sellerAllowlisted) {
        cardCheckoutBlockedReason =
          "Card checkout is limited to approved test accounts (buyer and seller are not on the allowlist).";
      } else if (!buyerAllowlisted) {
        cardCheckoutBlockedReason =
          "Card checkout is limited to approved test accounts (your buyer account is not on the allowlist).";
      } else if (!sellerAllowlisted) {
        cardCheckoutBlockedReason =
          "Card checkout is limited to approved test accounts (the seller of this listing is not on the allowlist).";
      } else if (session.id === sellerUserId) {
        cardCheckoutBlockedReason = "You cannot buy your own listing.";
      } else if (!listingProtectedOk && !listingDirectOk) {
        cardCheckoutBlockedReason =
          "This listing does not accept card payments.";
      } else {
        cardCheckoutBlockedReason =
          "Card checkout is unavailable for this listing.";
      }
    }

    let protectedBlockedReason: string | null = null;
    let directBlockedReason: string | null = null;
    if (listing.isDbListing) {
      if (!listingProtectedOk) {
        protectedBlockedReason =
          "This item is available for Direct Payment only.";
      } else if (!canProtectedCheckout) {
        if (!isProtectedPaymentsEnabled()) {
          protectedBlockedReason = "Protected Payment is not enabled.";
        } else if (!sellerConnectReady) {
          protectedBlockedReason =
            "Seller must complete Payments & Payouts before Protected Payment.";
        } else if (!allowlistOk) {
          protectedBlockedReason =
            cardCheckoutBlockedReason ||
            "Protected Payment is limited to approved test accounts.";
        }
      }
      if (!listingDirectOk) {
        directBlockedReason =
          "This item is available for Protected Payment only.";
      } else if (!canDirectCheckout) {
        if (!isDirectPaymentsEnabled()) {
          directBlockedReason = "Direct Payment is not enabled.";
        } else if (!sellerConnectReady) {
          directBlockedReason =
            "Seller must complete Payments & Payouts before Direct Payment.";
        } else if (!allowlistOk) {
          directBlockedReason =
            cardCheckoutBlockedReason ||
            "Direct Payment is limited to approved test accounts.";
        }
      }
    }

    return Response.json({
      listing,
      seller: {
        ...seller,
        id: listing.isDbListing ? sellerUserId : seller.id,
      },
      cryptoPaymentMethods: methods,
      paymentOptions,
      paymentFlags,
      availablePaymentMethods: {
        protected: canProtectedCheckout,
        direct: canDirectCheckout,
      },
      protectedBlockedReason,
      directBlockedReason,
      sellerConnectReady,
      canStripeCardCheckout,
      canProtectedCheckout,
      canDirectCheckout,
      cardCheckoutBlockedReason,
      allowlistGate: {
        configured: allowlistConfigured,
        entryCount: allowlistEntryCount,
        sessionPresent: Boolean(session),
        buyerAllowlisted: session ? buyerAllowlisted : null,
        sellerAllowlisted: listing.isDbListing ? sellerAllowlisted : null,
        comparisonFields: ["User.id", "User.email"],
      },
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
