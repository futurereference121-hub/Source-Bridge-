import { getListingBySlugAsync } from "@/lib/listings-service";
import { getMemberForListingAsync } from "@/lib/listings-service";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/validation";
import { checkoutPublicConfig } from "@/lib/payments/checkout";
import { paymentFlagsSnapshot } from "@/lib/payments/flags";
import { parseListingPaymentOptions } from "@/lib/payments/listing-options";
import { getConnectStatus } from "@/lib/payments/stripe/connect";

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
        select: { paymentOptions: true },
      });
      paymentOptions = parseListingPaymentOptions(row?.paymentOptions);
      const connect = await getConnectStatus(listing.memberId);
      sellerConnectReady = connect.canReceiveProtectedPayments;
    }

    const stripe = checkoutPublicConfig();
    const flags = paymentFlagsSnapshot();

    return Response.json({
      listing,
      seller,
      cryptoPaymentMethods: methods,
      paymentOptions,
      sellerConnectReady,
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
