import { prisma } from "@/lib/db";
import { deleteStoredImageForUser } from "@/lib/storage";

export async function syncListingImages(listingId: string, urls: string[]) {
  const clean = [
    ...new Set(
      urls.filter(
        (url) =>
          typeof url === "string" &&
          url.trim() &&
          !url.startsWith("blob:") &&
          !url.includes("/placeholders/"),
      ),
    ),
  ];
  const listing = await prisma.stockListing.findUniqueOrThrow({
    where: { id: listingId },
    include: { listingImages: true },
  });
  const removed = listing.listingImages.filter((image) => !clean.includes(image.url));
  await prisma.$transaction(async (tx) => {
    await tx.stockListing.update({ where: { id: listingId }, data: { images: JSON.stringify(clean) } });
    for (const [sortOrder, url] of clean.entries()) {
      await tx.listingImage.upsert({
        where: { listingId_url: { listingId, url } },
        create: { listingId, url, sortOrder, isCover: sortOrder === 0 },
        update: { sortOrder, isCover: sortOrder === 0 },
      });
    }
    if (removed.length) await tx.listingImage.deleteMany({ where: { id: { in: removed.map((image) => image.id) } } });
  });
  await Promise.allSettled(removed.map((image) => deleteStoredImageForUser(image.url, listing.userId)));
}
