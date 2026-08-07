import { prisma } from "@/lib/db";

/**
 * Listing inventory lifecycle for Protected Payment product checkout.
 * AVAILABLE → RESERVED (checkout start) → SOLD (final release)
 * Cancel/failed pre-release → AVAILABLE again when reservation held for this buyer/txn.
 */

export async function markListingSoldIfLinked(listingId: string | null | undefined) {
  if (!listingId) return;
  await prisma.stockListing.updateMany({
    where: {
      id: listingId,
      saleStatus: { in: ["RESERVED", "AVAILABLE"] },
    },
    data: {
      saleStatus: "SOLD",
      inventoryReserved: "{}",
    },
  });
}

export async function releaseListingReservation(
  listingId: string | null | undefined,
  buyerId?: string | null,
) {
  if (!listingId) return;
  const row = await prisma.stockListing.findUnique({
    where: { id: listingId },
    select: { id: true, saleStatus: true, inventoryReserved: true },
  });
  if (!row || row.saleStatus !== "RESERVED") return;

  if (buyerId) {
    try {
      const meta = JSON.parse(row.inventoryReserved || "{}") as {
        buyerId?: string;
      };
      if (meta.buyerId && meta.buyerId !== buyerId) return;
    } catch {
      /* still free if unparsable */
    }
  }

  await prisma.stockListing.update({
    where: { id: listingId },
    data: {
      saleStatus: "AVAILABLE",
      inventoryReserved: "{}",
    },
  });
}
