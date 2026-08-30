/**
 * NON-FINANCIAL: repair buyer listed-product shipping notification deep-links.
 * Idempotent — updates wrong /profile/purchases hrefs; does not create money objects.
 *
 * Run: node --env-file=.env scripts/_backfill-product-purchase-notifications.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const stale = await prisma.notification.findMany({
    where: {
      type: "PAYMENT_SHIPPING",
      dedupeKey: { startsWith: "pt-shipped:" },
      href: "/profile/purchases",
    },
    select: { id: true, dedupeKey: true, userId: true, title: true },
  });

  let updated = 0;
  for (const row of stale) {
    const txnId = String(row.dedupeKey || "").replace(/^pt-shipped:/, "").trim();
    if (!txnId) continue;
    const txn = await prisma.protectedTransaction.findUnique({
      where: { id: txnId },
      select: { id: true, title: true, origin: true, buyerId: true },
    });
    if (!txn || txn.origin !== "PRODUCT_CHECKOUT" || txn.buyerId !== row.userId) {
      continue;
    }
    const productTitle = (txn.title || "your order").slice(0, 80);
    await prisma.notification.update({
      where: { id: row.id },
      data: {
        href: `/profile/purchases/${txnId}`,
        title: `${productTitle} was marked shipped`,
      },
    });
    updated += 1;
    console.log("UPDATED", row.id, txnId, productTitle);
  }

  const missingBuyerConfirm = await prisma.protectedTransaction.findMany({
    where: {
      origin: "PRODUCT_CHECKOUT",
      fundedAt: { not: null },
    },
    select: { id: true, buyerId: true, sellerId: true, title: true },
    take: 200,
    orderBy: { fundedAt: "desc" },
  });

  let created = 0;
  for (const txn of missingBuyerConfirm) {
    const dedupeKey = `buyer-funded:${txn.id}`;
    const existing = await prisma.notification.findFirst({
      where: { userId: txn.buyerId, dedupeKey },
      select: { id: true },
    });
    if (existing) continue;
    const productTitle = (txn.title || "your order").slice(0, 80);
    await prisma.notification.create({
      data: {
        userId: txn.buyerId,
        type: "PAYMENT_STATUS",
        title: `Payment confirmed for ${productTitle}`,
        body: "Open Purchases to track your order.",
        href: `/profile/purchases/${txn.id}`,
        actorId: txn.sellerId,
        actorName: "Seller",
        dedupeKey,
      },
    });
    created += 1;
    console.log("CREATED buyer-funded", txn.id);
  }

  console.log(
    JSON.stringify({ staleShippingFixed: updated, buyerConfirmCreated: created }),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
