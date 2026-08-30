import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { adminLiveQueueDisputeWhere } from "@/lib/payments/admin-live-queue";
import { formatMinor } from "@/lib/payments/money";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
import { derivePurchaseDisplayState } from "@/lib/payments/purchase-display-state";
import PaymentIssueActions from "../payments/issue-actions";
import DisputeReviewActions from "./dispute-review-actions";
import AdminDisputeMessageLink from "./admin-dispute-message-link";
import AdminCaseAccordion from "./admin-case-accordion";
import AdminEvidenceGallery from "./admin-evidence-gallery";

const resolvedStatuses = [
  "RESOLVED_BUYER",
  "RESOLVED_SELLER",
  "RESOLVED_SPLIT",
  "CLOSED",
] as const;

export default async function AdminReviewsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/sign-in");
  if (!isAdminUser(user)) redirect("/explore");
  if (user.mustChangePassword) redirect("/admin/change-password");

  const disputes = await prisma.disputeCase.findMany({
    where: adminLiveQueueDisputeWhere({ in: ["OPEN", "UNDER_REVIEW"] }),
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
          platformFeeRefundedMinor: true,
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

  const resolvedDisputes = await prisma.disputeCase.findMany({
    where: adminLiveQueueDisputeWhere({ in: [...resolvedStatuses] }),
    orderBy: { resolvedAt: "desc" },
    take: 20,
    include: {
      protectedTxn: {
        select: {
          title: true,
          currency: true,
          refundedMinor: true,
          finalTransferredMinor: true,
          procurementTransferredMinor: true,
          buyer: { select: { username: true, name: true } },
          seller: { select: { username: true, name: true } },
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
        Expand a case in place for evidence, messaging, and financial controls.
        Cases open collapsed by default.
      </p>

      <div className="mt-8 space-y-4">
        {disputes.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">
            No open item issues.
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
            const orderDisplay =
              t.origin === "PRODUCT_CHECKOUT"
                ? derivePurchaseDisplayState({
                    status: t.status,
                    paymentOption: t.paymentOption,
                    origin: t.origin,
                    openDispute: true,
                  }).shortLabel
                : t.status.replace(/_/g, " ");
            return (
              <AdminCaseAccordion
                key={issue.id}
                id={issue.id}
                summary={
                  <div className="flex w-full flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-white">{t.title}</p>
                        <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/60">
                          {issue.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-white/45">
                        {new Date(issue.createdAt).toLocaleString()} · {orderDisplay}{" "}
                        · Buyer {buyerLabel} · Sourcer {sellerLabel}
                      </p>
                      {issue.category || issue.reason ? (
                        <p className="mt-1 truncate text-xs text-white/55">
                          {issue.category || issue.reason}
                        </p>
                      ) : null}
                    </div>
                    <p className="text-xs text-white/50">
                      {formatMinor(books.finalResidualMinor, t.currency)} seller
                      remaining · {formatMinor(books.refundableMinor, t.currency)}{" "}
                      refundable
                    </p>
                  </div>
                }
              >
                {issue.category ? (
                  <p className="text-sm font-medium text-amber-100/90">
                    {issue.category}
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-white/70">
                  {issue.reason}
                  {issue.details
                    ? ` — ${issue.details
                        .replace(/https?:\/\/\S+/gi, "")
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 240)}`
                    : ""}
                </p>
                <AdminEvidenceGallery details={issue.details} />
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
                  <AdminDisputeMessageLink
                      disputeId={issue.id}
                      role="BUYER"
                      label={`Message buyer (${buyerLabel})`}
                      adminUserId={user.id}
                    />
                    <AdminDisputeMessageLink
                      disputeId={issue.id}
                      role="SELLER"
                      label={`Message sourcer (${sellerLabel})`}
                      adminUserId={user.id}
                    />
                  {t.conversationId ? (
                    <Link
                      href={`/inbox/${t.conversationId}`}
                      className="rounded-lg border border-white/20 px-3 py-1.5 text-electric hover:text-electric-hover"
                    >
                      View chat
                    </Link>
                  ) : null}
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
                    dispute {issue.id}
                    <br />
                    txn {t.id}
                    {t.paymentTicket?.id ? (
                      <>
                        <br />
                        ticket {t.paymentTicket.id}
                      </>
                    ) : null}
                  </p>
                </details>
              </AdminCaseAccordion>
            );
          })
        )}
      </div>

      {resolvedDisputes.length > 0 ? (
        <div className="mt-10 space-y-3">
          <p className="text-sm font-medium text-white/70">
            Resolved disputes ({resolvedDisputes.length})
          </p>
          {resolvedDisputes.map((issue) => {
            const t = issue.protectedTxn;
            const released =
              t.procurementTransferredMinor + t.finalTransferredMinor;
            const buyer = t.buyer.username
              ? `@${t.buyer.username}`
              : t.buyer.name;
            const seller = t.seller.username
              ? `@${t.seller.username}`
              : t.seller.name;
            return (
              <AdminCaseAccordion
                key={issue.id}
                id={issue.id}
                summary={
                  <div className="min-w-0 flex-1 text-left">
                    <p className="font-medium text-white">{t.title}</p>
                    <p className="mt-1 text-xs text-white/45">
                      {issue.status.replace(/_/g, " ")} · Buyer {buyer} ·
                      Sourcer {seller}
                    </p>
                  </div>
                }
              >
                <p className="text-xs text-white/55">
                  {issue.resolutionNote
                    ? issue.resolutionNote.slice(0, 240)
                    : "Resolved"}
                </p>
                <p className="mt-2 text-xs text-white/40">
                  Refunded {formatMinor(t.refundedMinor, t.currency)} · Released{" "}
                  {formatMinor(released, t.currency)}
                </p>
                <details className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/45">
                  <summary className="cursor-pointer">Advanced / Audit</summary>
                  <p className="mt-2 font-mono break-all">dispute {issue.id}</p>
                </details>
              </AdminCaseAccordion>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
