import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMinor } from "@/lib/payments/money";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";

export default async function AdminProtectedPurchasesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/sign-in");
  if (!isAdminUser(user)) redirect("/explore");
  if (user.mustChangePassword) redirect("/admin/change-password");

  const rows = await prisma.protectedTransaction.findMany({
    where: { origin: "PRODUCT_CHECKOUT" },
    orderBy: { updatedAt: "desc" },
    take: 80,
    select: {
      id: true,
      status: true,
      paymentOption: true,
      title: true,
      currency: true,
      totalChargeMinor: true,
      itemCostMinor: true,
      shippingMinor: true,
      sellerServiceFeeMinor: true,
      protectionFeeMinor: true,
      procurementAdvanceAgreed: true,
      procurementAdvanceMinor: true,
      procurementTransferredMinor: true,
      finalTransferredMinor: true,
      refundedMinor: true,
      trackingNumber: true,
      trackingCarrier: true,
      shippedAt: true,
      deliveredAt: true,
      inspectionEndsAt: true,
      fundedAt: true,
      listingId: true,
      buyer: { select: { username: true, name: true } },
      seller: { select: { username: true, name: true } },
      listing: { select: { name: true, slug: true } },
      paymentTicket: { select: { id: true } },
      disputes: {
        where: { status: { in: ["OPEN", "UNDER_REVIEW"] } },
        select: { id: true, status: true },
        take: 1,
      },
    },
  });

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-electric">
        Protected Purchases
      </p>
      <h1 className="mt-2 font-display text-4xl">Listing purchases</h1>
      <p className="mt-2 max-w-2xl text-sm text-white/55">
        Product Purchase Tickets from protected listing checkout. Disputes go to{" "}
        <Link href="/admin/reviews" className="text-electric hover:underline">
          Reviews &amp; Disputes
        </Link>
        . Direct historical purchases are listed for visibility only.
      </p>
      <div className="mt-8 space-y-3">
        {rows.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">
            No listing checkouts yet.
          </p>
        ) : (
          rows.map((t) => {
            const books = computeProtectedFinancials(t);
            const buyer = t.buyer.username
              ? `@${t.buyer.username}`
              : t.buyer.name;
            const seller = t.seller.username
              ? `@${t.seller.username}`
              : t.seller.name;
            const dispute = t.disputes[0];
            return (
              <Link
                key={t.id}
                href={`/admin/purchases/${t.id}`}
                className="block rounded-xl border border-white/10 bg-white/5 p-4 hover:border-electric/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">
                      {t.listing?.name || t.title}
                    </p>
                    <p className="mt-1 text-xs text-white/45">
                      {isDirectPaymentOption(t.paymentOption)
                        ? "Direct Payment"
                        : "Protected Payment"}{" "}
                      · {t.status.replace(/_/g, " ")} · Buyer {buyer} · Seller{" "}
                      {seller}
                    </p>
                    {t.trackingNumber ? (
                      <p className="mt-1 text-xs text-white/50">
                        {t.trackingCarrier || "Carrier"} {t.trackingNumber}
                      </p>
                    ) : null}
                    {dispute ? (
                      <p className="mt-1 text-xs text-amber-200/80">
                        Open dispute — {dispute.status.replace(/_/g, " ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right text-xs text-white/55">
                    <p>{formatMinor(t.totalChargeMinor, t.currency)}</p>
                    <p>
                      Remaining seller{" "}
                      {formatMinor(books.finalResidualMinor, t.currency)}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </>
  );
}
