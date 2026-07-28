import { prisma } from "@/lib/db";
import { dbStockToListing } from "@/lib/member-map";
import { jsonError } from "@/lib/validation";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Public checkout bootstrap: listing + seller's enabled crypto payment methods.
 * Does not expose private keys or disabled methods.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    const listing = await prisma.stockListing.findUnique({
      where: { slug },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            slug: true,
            photo: true,
          },
        },
      },
    });
    if (!listing) return jsonError("Listing not found", 404);

    const methods = await prisma.sellerPaymentMethod.findMany({
      where: {
        userId: listing.userId,
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

    return Response.json({
      listing: dbStockToListing(listing),
      seller: listing.user,
      cryptoPaymentMethods: methods,
      stripeConfigured: false,
    });
  } catch (err) {
    console.error("[checkout:listing]", err);
    return jsonError("Failed to load checkout", 500);
  }
}
