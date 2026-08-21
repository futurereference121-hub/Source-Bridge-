import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMinor } from "@/lib/payments/money";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";
import AdminCaseAccordion from "../reviews/admin-case-accordion";
import PaymentIssueActions from "../payments/issue-actions";

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
      platformFeeRefundedMinor: true,
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
      conversationId: true,
      buyer: { select: { username: true, name: true } },
      seller: { select: { username: true, name: true } },
      listing: { select: { name: true, slug: true } },
      paymentTicket: { select: { id: true } },
      disputes: {
        where: { status: { in: ["OPEN", "UNDER_REVIEW"] } },
        select: {
          id: true,
          status: true,
          reason: true,
          details: true,
          category: true,
        },
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
        Expand a purchase in place for status and admin financial controls.
        Cases are collapsed by default.
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
              <AdminCaseAccordion
                key={t.id}
                id={t.id}
                summary={
                  <div className="flex w-full flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 text-left">
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
                      {dispute ? (
                        <p className="mt-1 text-xs text-amber-200/80">
                          Item issue — {dispute.status.replace(/_/g, " ")}
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
                }
              >
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-white/40">Total paid</dt>
                    <dd>{formatMinor(t.totalChargeMinor, t.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Already released</dt>
                    <dd>
                      {formatMinor(
                        books.procurementTransferredMinor +
                          books.finalTransferredMinor,
                        t.currency,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Remaining seller funds</dt>
                    <dd>
                      {formatMinor(books.finalResidualMinor, t.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-white/40">SB fee</dt>
                    <dd>
                      {formatMinor(books.platformFeeMinor, t.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Safely refundable</dt>
                    <dd>
                      {formatMinor(books.refundableMinor, t.currency)}
                    </dd>
                  </div>
                </dl>
                {t.trackingNumber ? (
                  <p className="mt-3 text-xs text-white/50">
                    {t.trackingCarrier || "Carrier"} {t.trackingNumber}
                  </p>
                ) : null}
                {t.conversationId ? (
                  <Link
                    href={`/inbox/${t.conversationId}`}
                    className="mt-3 inline-block text-xs text-electric hover:underline"
                  >
                    View chat
                  </Link>
                ) : null}
                {dispute && !isDirectPaymentOption(t.paymentOption) ? (
                  <PaymentIssueActions
                    disputeId={dispute.id}
                    currency={t.currency}
                    totalPaidMinor={t.totalChargeMinor}
                    platformFeeMinor={books.platformFeeMinor}
                    platformFeeRefundedMinor={t.platformFeeRefundedMinor ?? 0}
                    finalResidualMinor={books.finalResidualMinor}
                    refundableMinor={books.refundableMinor}
                    sellerEntitledMinor={books.sellerEntitledMinor}
                    alreadyReleasedMinor={
                      books.procurementTransferredMinor +
                      books.finalTransferredMinor
                    }
                    protectedRemainingMinor={books.protectedRemainingMinor}
                  />
                ) : !isDirectPaymentOption(t.paymentOption) &&
                  ["FUNDED", "PROCUREMENT_RELEASED", "AWAITING_SHIPMENT", "IN_TRANSIT", "DELIVERED", "IN_INSPECTION", "DISPUTED", "READY_TO_RELEASE", "PARTIALLY_REFUNDED"].includes(
                    t.status,
                  ) ? (
                  <PaymentIssueActions
                    protectedTxnId={t.id}
                    currency={t.currency}
                    totalPaidMinor={t.totalChargeMinor}
                    platformFeeMinor={books.platformFeeMinor}
                    platformFeeRefundedMinor={t.platformFeeRefundedMinor ?? 0}
                    finalResidualMinor={books.finalResidualMinor}
                    refundableMinor={books.refundableMinor}
                    sellerEntitledMinor={books.sellerEntitledMinor}
                    alreadyReleasedMinor={
                      books.procurementTransferredMinor +
                      books.finalTransferredMinor
                    }
                    protectedRemainingMinor={books.protectedRemainingMinor}
                  />
                ) : null}
                <details className="mt-4 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/45">
                  <summary className="cursor-pointer text-white/55">
                    Advanced / Audit
                  </summary>
                  <p className="mt-2 font-mono break-all">
                    txn {t.id}
                    {t.paymentTicket?.id ? (
                      <>
                        <br />
                        ticket {t.paymentTicket.id}
                      </>
                    ) : null}
                    {dispute ? (
                      <>
                        <br />
                        dispute {dispute.id}
                      </>
                    ) : null}
                  </p>
                </details>
              </AdminCaseAccordion>
            );
          })
        )}
      </div>
    </>
  );
}
