import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMinor } from "@/lib/payments/money";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
import PaymentIssueActions from "../payments/issue-actions";
import DisputeReviewActions from "./dispute-review-actions";

export default async function AdminReviewsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/sign-in");
  if (!isAdminUser(user)) redirect("/explore");
  if (user.mustChangePassword) redirect("/admin/change-password");

  const disputes = await prisma.disputeCase.findMany({
    where: { status: { in: ["OPEN", "UNDER_REVIEW"] } },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: {
      openedBy: {
        select: { id: true, username: true, name: true, email: true },
      },
      protectedTxn: {
        select: {
          id: true,
          status: true,
          paymentOption: true,
          origin: true,
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
          conversationId: true,
          buyerId: true,
          sellerId: true,
          paymentTicket: { select: { id: true } },
          buyer: {
            select: { id: true, username: true, name: true, email: true },
          },
          seller: {
            select: { id: true, username: true, name: true, email: true },
          },
        },
      },
    },
  });

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-electric">
        Reviews & disputes
      </p>
      <h1 className="mt-2 font-display text-4xl">Payment disputes</h1>
      <p className="mt-2 max-w-2xl text-sm text-white/55">
        Buyer-reported issues during the 12-hour inspection window. Financial
        operations and release controls live on{" "}
        <Link href="/admin/payments" className="text-electric hover:text-electric-hover">
          Protected Payments
        </Link>
        .
      </p>
      <p className="mt-2 text-xs text-white/40">
        Terms &amp; Conditions acceptance for disputes is a future legal
        requirement — not enforced in TEST yet. See{" "}
        <code className="text-white/55">docs/PAYMENT_DISPUTES_AND_TERMS.md</code>.
      </p>

      <div className="mt-8 space-y-4">
        {disputes.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">
            No open payment disputes.
          </p>
        ) : (
          disputes.map((issue) => {
            const t = issue.protectedTxn;
            const books = computeProtectedFinancials({
              itemCostMinor: t.itemCostMinor,
              shippingMinor: t.shippingMinor,
              sellerServiceFeeMinor: t.sellerServiceFeeMinor,
              protectionFeeMinor: t.protectionFeeMinor,
              totalChargeMinor: t.totalChargeMinor,
              procurementAdvanceAgreed: t.procurementAdvanceAgreed,
              procurementAdvanceMinor: t.procurementAdvanceMinor,
              procurementTransferredMinor: t.procurementTransferredMinor,
              finalTransferredMinor: t.finalTransferredMinor,
              refundedMinor: t.refundedMinor,
            });
            const buyerLabel = t.buyer.username
              ? `@${t.buyer.username}`
              : t.buyer.name || t.buyer.email;
            const sellerLabel = t.seller.username
              ? `@${t.seller.username}`
              : t.seller.name || t.seller.email;
            return (
              <div
                key={issue.id}
                className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-white">{t.title}</p>
                      <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/60">
                        {issue.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-white/45">
                      txn {t.id} · dispute {issue.id}
                    </p>
                    {issue.category ? (
                      <p className="mt-2 text-sm font-medium text-amber-100/90">
                        {issue.category}
                      </p>
                    ) : null}
                    <p className="mt-1 text-sm text-white/70">
                      {issue.reason}
                      {issue.details ? ` — ${issue.details.slice(0, 240)}` : ""}
                    </p>
                    {issue.adminNotes ? (
                      <p className="mt-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/55">
                        Admin notes: {issue.adminNotes}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-white/40">
                      Opened by{" "}
                      {issue.openedBy.username
                        ? `@${issue.openedBy.username}`
                        : issue.openedBy.name || issue.openedBy.email}
                      {" · "}
                      {new Date(issue.createdAt).toLocaleString()}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Link
                        href={`/admin/reviews/${issue.id}`}
                        className="rounded-lg border border-white/20 px-3 py-1.5 text-electric hover:text-electric-hover"
                      >
                        Open case
                      </Link>
                      {t.conversationId ? (
                        <span className="text-white/35">
                          Buyer {buyerLabel} · Sourcer {sellerLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-right text-xs text-white/55">
                    <p>
                      Residual protected:{" "}
                      {formatMinor(books.finalResidualMinor, t.currency)}
                    </p>
                    <p>
                      Refundable: {formatMinor(books.refundableMinor, t.currency)}
                    </p>
                    <p>
                      Item funds released early:{" "}
                      {formatMinor(books.itemFundsReleasedEarlyMinor, t.currency)}
                    </p>
                  </div>
                </div>
                <DisputeReviewActions
                  disputeId={issue.id}
                  status={issue.status}
                  adminNotes={issue.adminNotes}
                />
                {issue.status === "OPEN" || issue.status === "UNDER_REVIEW" ? (
                  <PaymentIssueActions
                    disputeId={issue.id}
                    currency={t.currency}
                    finalResidualMinor={books.finalResidualMinor}
                    refundableMinor={books.refundableMinor}
                    sellerEntitledMinor={books.sellerEntitledMinor}
                    alreadyReleasedMinor={
                      books.procurementTransferredMinor + books.finalTransferredMinor
                    }
                    protectedRemainingMinor={books.protectedRemainingMinor}
                  />
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
