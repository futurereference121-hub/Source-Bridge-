import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { paymentFlagsSnapshot } from "@/lib/payments/flags";
import { getPlatformPaymentConfig } from "@/lib/payments/config";
import { CHARGE_MODEL, isStripeConfigured } from "@/lib/payments/stripe/client";
import { formatMinor } from "@/lib/payments/money";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
import PaymentIssueActions from "./issue-actions";
import InactivityReleasePanel from "./inactivity-release-panel";

export default async function AdminPaymentsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/sign-in");
  if (!isAdminUser(user)) redirect("/explore");
  if (user.mustChangePassword) redirect("/admin/change-password");

  const flags = paymentFlagsSnapshot();
  const config = await getPlatformPaymentConfig();

  const [
    funded,
    inFlight,
    disputed,
    released,
    failedTransfers,
    openDisputes,
    openIssues,
    recent,
  ] = await Promise.all([
    prisma.protectedTransaction.count({ where: { status: "FUNDED" } }),
    prisma.protectedTransaction.count({
      where: {
        status: {
          in: [
            "PROCUREMENT_RELEASED",
            "AWAITING_SHIPMENT",
            "IN_TRANSIT",
            "DELIVERED",
            "IN_INSPECTION",
            "READY_TO_RELEASE",
          ],
        },
      },
    }),
    prisma.protectedTransaction.count({ where: { status: "DISPUTED" } }),
    prisma.protectedTransaction.count({ where: { status: "RELEASED" } }),
    prisma.transferAttempt.count({ where: { status: "FAILED" } }),
    prisma.disputeCase.count({ where: { status: "OPEN" } }),
    prisma.disputeCase.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "asc" },
      take: 50,
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
            paymentTicket: { select: { id: true } },
          },
        },
      },
    }),
    prisma.protectedTransaction.findMany({
      take: 25,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        status: true,
        paymentOption: true,
        currency: true,
        totalChargeMinor: true,
        stripeMode: true,
        updatedAt: true,
      },
    }),
  ]);

  const cards = [
    ["Funded", funded],
    ["In flight", inFlight],
    ["Disputed", disputed],
    ["Released", released],
    ["Failed transfers", failedTransfers],
    ["Open payment issues", openDisputes],
  ] as const;

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-electric">
        Financial operations
      </p>
      <h1 className="mt-2 font-display text-4xl">Protected Payments</h1>
      <p className="mt-2 max-w-2xl text-sm text-white/55">
        Stripe is the processor ({CHARGE_MODEL}). Source Bridge owns transaction
        state and transfer timing. Live mode is forced off.
      </p>

      <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
        <p>
          Stripe configured: {isStripeConfigured() ? "yes" : "no"} · Mode:{" "}
          {flags.stripeMode} · LIVE_PAYMENTS_ENABLED: false
        </p>
        <p className="mt-1">
          Flags — payments: {String(flags.PAYMENTS_ENABLED)}, connect
          onboarding: {String(flags.CONNECT_ONBOARDING_ENABLED)}, protected:{" "}
          {String(flags.PROTECTED_PAYMENTS_ENABLED)}, instant:{" "}
          {String(flags.INSTANT_PAYMENTS_ENABLED)}, procurement:{" "}
          {String(flags.PROCUREMENT_ADVANCES_ENABLED)}, test allowlist
          configured:{" "}
          {String(flags.PAYMENTS_TEST_ALLOWLIST_CONFIGURED)}
        </p>
        <p className="mt-1">
          Protection fee: {config.protectionFeeBps} bps (floor{" "}
          {config.protectionFeeFloorMinor} minor) · Inspection:{" "}
          {config.inspectionHours}h · Procurement min trust:{" "}
          {config.procurementMinTrustLevel}
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-white/10 bg-white/5 p-5"
          >
            <p className="text-sm text-white/60">{label}</p>
            <p className="mt-2 text-3xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-semibold">Open payment issues</h2>
      <p className="mt-1 text-sm text-white/50">
        Buyer-reported problems during inspection. Already-released item funds
        are shown separately; fee is never treated as protected seller residual.
      </p>
      <div className="mt-4 space-y-4">
        {openIssues.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">
            No open payment issues.
          </p>
        ) : (
          openIssues.map((issue) => {
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
            return (
              <div
                key={issue.id}
                className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{t.title}</p>
                    <p className="mt-1 font-mono text-xs text-white/45">
                      txn {t.id} · dispute {issue.id}
                    </p>
                    <p className="mt-1 text-sm text-white/70">
                      {issue.reason}
                      {issue.details ? ` — ${issue.details.slice(0, 180)}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-white/40">
                      Opened by{" "}
                      {issue.openedBy.username
                        ? `@${issue.openedBy.username}`
                        : issue.openedBy.name || issue.openedBy.email}
                      {" · "}
                      {t.origin}
                      {t.paymentTicket?.id ? " · sourcing ticket" : ""}
                      {t.conversationId ? (
                        <>
                          {" · "}
                          <Link
                            href={`/inbox/${t.conversationId}`}
                            className="text-electric hover:underline"
                          >
                            chat
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <p className="text-sm text-white/50">{t.status}</p>
                </div>
                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt className="text-white/40">Gross charged</dt>
                    <dd className="text-white/85">
                      {formatMinor(books.grossFundedMinor, t.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Already released (item)</dt>
                    <dd className="text-white/85">
                      {formatMinor(
                        books.procurementTransferredMinor,
                        t.currency,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Remaining seller residual</dt>
                    <dd className="text-white/85">
                      {formatMinor(books.finalResidualMinor, t.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Platform fee (not residual)</dt>
                    <dd className="text-white/85">
                      {formatMinor(books.platformFeeMinor, t.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Refundable on platform</dt>
                    <dd className="text-white/85">
                      {formatMinor(books.refundableMinor, t.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Protected remaining</dt>
                    <dd className="text-white/85">
                      {formatMinor(books.protectedRemainingMinor, t.currency)}
                    </dd>
                  </div>
                </dl>
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
              </div>
            );
          })
        )}
      </div>

      <InactivityReleasePanel />

      <h2 className="mt-10 text-lg font-semibold">Recent protected transactions</h2>
      <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/5 text-white/50">
            <tr>
              <th className="px-3 py-2 font-medium">ID</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Option</th>
              <th className="px-3 py-2 font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Mode</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-white/40" colSpan={5}>
                  No protected transactions yet.
                </td>
              </tr>
            ) : (
              recent.map((row) => (
                <tr key={row.id} className="border-t border-white/10">
                  <td className="px-3 py-2 font-mono text-xs text-white/70">
                    {row.id.slice(0, 12)}…
                  </td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2">{row.paymentOption}</td>
                  <td className="px-3 py-2">
                    {formatMinor(row.totalChargeMinor, row.currency)}
                  </td>
                  <td className="px-3 py-2">{row.stripeMode}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-xs text-white/40">
        Sensitive actions require re-auth + reason via audited APIs. There is no
        universal “mark completed” bypass. Never release on fully completed
        historical TXNs.
      </p>
      <Link
        href="/admin"
        className="mt-4 inline-block text-sm text-electric hover:text-electric-hover"
      >
        ← Admin home
      </Link>
    </>
  );
}
