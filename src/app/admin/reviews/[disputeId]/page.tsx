import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMinor } from "@/lib/payments/money";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
import { listAdminDisputeThreads } from "@/lib/payments/admin-dispute-threads";
import PaymentIssueActions from "../../payments/issue-actions";
import DisputeReviewActions from "../dispute-review-actions";
import AdminDisputeMessenger from "../admin-dispute-messenger";

type Props = { params: Promise<{ disputeId: string }> };

export default async function AdminDisputeCasePage({ params }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/sign-in");
  if (!isAdminUser(user)) redirect("/explore");
  if (user.mustChangePassword) redirect("/admin/change-password");

  const { disputeId } = await params;
  const issue = await prisma.disputeCase.findUnique({
    where: { id: disputeId },
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
  if (!issue) notFound();

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
  const threads = await listAdminDisputeThreads(issue.id);
  const buyerThread = threads.find((c) => c.adminPartyRole === "BUYER") ?? null;
  const sellerThread = threads.find((c) => c.adminPartyRole === "SELLER") ?? null;
  const buyerLabel = t.buyer.username
    ? `@${t.buyer.username}`
    : t.buyer.name || t.buyer.email;
  const sellerLabel = t.seller.username
    ? `@${t.seller.username}`
    : t.seller.name || t.seller.email;

  function mapThread(c: (typeof threads)[number] | null) {
    if (!c) return null;
    return {
      id: c.id,
      adminPartyRole: c.adminPartyRole,
      subject: c.subject,
      messages: c.messages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        sender: m.sender
          ? { id: m.sender.id, name: m.sender.name, username: m.sender.username }
          : null,
        attachments: (m.attachments || []).map((a) => ({
          id: a.id,
          url: a.url,
        })),
      })),
    };
  }

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-electric">
        Dispute case
      </p>
      <h1 className="mt-2 font-display text-4xl">{t.title}</h1>
      <p className="mt-2 font-mono text-xs text-white/45">
        dispute {issue.id} · txn {t.id}
        {t.paymentTicket?.id ? ` · ticket ${t.paymentTicket.id}` : ""}
      </p>
      <p className="mt-2 text-sm text-white/60">
        {issue.category ? `${issue.category} — ` : ""}
        {issue.reason}
        {issue.details ? ` — ${issue.details}` : ""}
      </p>
      <p className="mt-2 text-xs text-white/40">
        Status {issue.status.replace(/_/g, " ")} · Buyer {buyerLabel} · Sourcer{" "}
        {sellerLabel}
      </p>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <Link href="/admin/reviews" className="text-electric hover:underline">
          All disputes
        </Link>
        {t.conversationId ? (
          <Link
            href={`/inbox/${t.conversationId}`}
            className="text-white/50 hover:text-electric"
          >
            Buyer↔Sourcer conversation (separate)
          </Link>
        ) : null}
      </div>

      <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-5">
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-white/40">Residual protected</dt>
            <dd>{formatMinor(books.finalResidualMinor, t.currency)}</dd>
          </div>
          <div>
            <dt className="text-white/40">Refundable</dt>
            <dd>{formatMinor(books.refundableMinor, t.currency)}</dd>
          </div>
          <div>
            <dt className="text-white/40">Item funds already released</dt>
            <dd>{formatMinor(books.itemFundsReleasedEarlyMinor, t.currency)}</dd>
          </div>
        </dl>
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
              books.procurementTransferredMinor + books.finalTransferredMinor
            }
            protectedRemainingMinor={books.protectedRemainingMinor}
          />
        ) : null}
      </div>

      <h2 className="mt-10 text-lg font-semibold">Private admin messaging</h2>
      <p className="mt-1 text-sm text-white/50">
        Left: Admin ↔ Buyer. Right: Admin ↔ Sourcer. Full chronological
        history, same messages as Inbox. Parties cannot see the other thread.
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AdminDisputeMessenger
          disputeId={issue.id}
          role="BUYER"
          label={`Message buyer (${buyerLabel})`}
          adminUserId={user.id}
          initialThread={mapThread(buyerThread)}
        />
        <AdminDisputeMessenger
          disputeId={issue.id}
          role="SELLER"
          label={`Message sourcer (${sellerLabel})`}
          adminUserId={user.id}
          initialThread={mapThread(sellerThread)}
        />
      </div>
    </>
  );
}
