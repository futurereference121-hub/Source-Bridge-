import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMinor } from "@/lib/payments/money";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";
import {
  adminMayReleaseAfterBuyerInactivity,
  BUYER_INACTIVITY_ADMIN_RELEASE_MS,
} from "@/lib/payments/fulfilment-rules";
import InactivityReleasePanel from "../../payments/inactivity-release-panel";

type Props = { params: Promise<{ txnId: string }> };

export default async function AdminProtectedPurchaseDetailPage({
  params,
}: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/sign-in");
  if (!isAdminUser(user)) redirect("/explore");
  if (user.mustChangePassword) redirect("/admin/change-password");

  const { txnId } = await params;
  const t = await prisma.protectedTransaction.findUnique({
    where: { id: txnId },
    include: {
      buyer: { select: { id: true, username: true, name: true, email: true } },
      seller: { select: { id: true, username: true, name: true, email: true } },
      listing: { select: { id: true, name: true, slug: true } },
      paymentTicket: { select: { id: true, conversationId: true } },
      disputes: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, status: true, reason: true, createdAt: true },
      },
    },
  });
  if (!t || t.origin !== "PRODUCT_CHECKOUT") notFound();

  const books = computeProtectedFinancials(t);
  const openDispute = t.disputes.find((d) =>
    ["OPEN", "UNDER_REVIEW"].includes(d.status),
  );
  const inactivity = adminMayReleaseAfterBuyerInactivity({
    origin: t.origin,
    paymentOption: t.paymentOption,
    status: t.status,
    shippedAt: t.shippedAt,
    deliveredAt: t.deliveredAt,
    openDispute: Boolean(openDispute),
    remainingSellerShareMinor: books.finalResidualMinor,
  });
  const buyer = t.buyer.username ? `@${t.buyer.username}` : t.buyer.name;
  const seller = t.seller.username ? `@${t.seller.username}` : t.seller.name;
  const windowHours = BUYER_INACTIVITY_ADMIN_RELEASE_MS / (60 * 60 * 1000);

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-electric">
        Protected purchase
      </p>
      <h1 className="mt-2 font-display text-4xl">
        {t.listing?.name || t.title}
      </h1>
      <p className="mt-2 font-mono text-xs text-white/45">txn {t.id}</p>
      <p className="mt-2 text-sm text-white/60">
        {isDirectPaymentOption(t.paymentOption)
          ? "Direct Payment"
          : "Protected Payment"}{" "}
        · {t.status.replace(/_/g, " ")} · Buyer {buyer} · Seller {seller}
      </p>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <Link href="/admin/purchases" className="text-electric hover:underline">
          All protected purchases
        </Link>
        {t.conversationId || t.paymentTicket?.conversationId ? (
          <Link
            href={`/inbox/${t.conversationId || t.paymentTicket?.conversationId}`}
            className="text-white/50 hover:text-electric"
          >
            Conversation
          </Link>
        ) : null}
        {openDispute ? (
          <Link
            href={`/admin/reviews/${openDispute.id}`}
            className="text-amber-200 hover:underline"
          >
            Open dispute
          </Link>
        ) : null}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
          <p className="text-[10px] uppercase tracking-[0.14em] text-white/40">
            Payment
          </p>
          <dl className="mt-2 space-y-1 text-white/75">
            <div className="flex justify-between gap-3">
              <dt>Total charged</dt>
              <dd>{formatMinor(t.totalChargeMinor, t.currency)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Already released</dt>
              <dd>
                {formatMinor(
                  books.procurementTransferredMinor + books.finalTransferredMinor,
                  t.currency,
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Remaining seller entitlement</dt>
              <dd>{formatMinor(books.finalResidualMinor, t.currency)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Refundable</dt>
              <dd>{formatMinor(books.refundableMinor, t.currency)}</dd>
            </div>
          </dl>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
          <p className="text-[10px] uppercase tracking-[0.14em] text-white/40">
            Shipping &amp; buyer state
          </p>
          <p className="mt-2 text-white/75">
            {t.shippedAt
              ? `Shipped ${new Date(t.shippedAt).toLocaleString()}`
              : "Not shipped"}
          </p>
          {t.trackingNumber ? (
            <p className="mt-1 text-white/60">
              {t.trackingCarrier || "Carrier"} · {t.trackingNumber}
            </p>
          ) : null}
          <p className="mt-2 text-white/75">
            {t.deliveredAt
              ? `Buyer marked received ${new Date(t.deliveredAt).toLocaleString()}`
              : "Buyer has not confirmed receipt"}
          </p>
          {t.inspectionEndsAt ? (
            <p className="mt-1 text-white/60">
              Inspection ends {new Date(t.inspectionEndsAt).toLocaleString()}
            </p>
          ) : null}
        </div>
      </div>

      {openDispute ? (
        <p className="mt-6 rounded-xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-50">
          An open dispute is on this purchase. Money moves belong on{" "}
          <Link
            href={`/admin/reviews/${openDispute.id}`}
            className="underline"
          >
            Reviews &amp; Disputes
          </Link>
          .
        </p>
      ) : inactivity.ok ? (
        <div className="mt-6">
          <p className="mb-2 text-sm text-white/55">
            Buyer inactivity window ({windowHours}h TEST) has elapsed. Admin may
            authorize remaining seller entitlement if shipping evidence supports
            it.
          </p>
          <InactivityReleasePanel windowHours={windowHours} />
        </div>
      ) : (
        <p className="mt-6 text-sm text-white/45">
          Residual release here follows protected-payment rules
          {inactivity.code ? ` (${inactivity.code.toLowerCase().replace(/_/g, " ")})` : ""}
          . Open disputes route to Reviews.
        </p>
      )}
    </>
  );
}
