"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { formatMinor } from "@/lib/payments/money";

type Order = {
  id: string;
  status: string;
  origin?: string;
  title: string;
  currency: string;
  totalChargeMinor: number;
  protectionFeeMinor: number;
  fundedAt: string | null;
  shippedAt: string | null;
  deliveredAt?: string | null;
  trackingNumber: string;
  trackingCarrier: string;
  inspectionEndsAt: string | null;
  conversationId?: string | null;
  paymentTicketId?: string | null;
  shipmentPhotoUrl?: string;
  labels: { payment: string; shipping: string; delivery: string };
  listing: { id: string; slug: string; name: string; saleStatus: string } | null;
  counterparty: {
    id: string;
    username: string | null;
    name: string;
    slug: string | null;
  } | null;
  actions: {
    canAddTracking: boolean;
    canRefreshTracking: boolean;
    canConfirmReceipt: boolean;
    canReleaseNow?: boolean;
    canReportIssue?: boolean;
    canReleaseProcurement?: boolean;
  };
  procurementAdvanceMinor?: number;
  procurementTransferredMinor?: number;
  books?: {
    finalResidualMinor?: number;
    remainingProtectedSellerShareMinor?: number;
    procurementTransferredMinor?: number;
    platformFeeMinor?: number;
    sellerEntitledMinor?: number;
  };
};

type Decision = "ACKNOWLEDGE" | "RELEASE_NOW" | "START_INSPECTION" | "REPORT_ISSUE";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function PurchasesPage() {
  const router = useRouter();
  const { account, signedIn, authReady, showToast } = useAppUi();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [issueId, setIssueId] = useState<string | null>(null);
  const [issueReason, setIssueReason] = useState("");
  const [issueDetails, setIssueDetails] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/payments/orders?role=buyer", {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load purchases");
      setOrders((data.orders || []) as Order[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authReady && !signedIn) router.replace("/sign-in");
  }, [authReady, signedIn, router]);

  useEffect(() => {
    if (authReady && signedIn) void load();
  }, [authReady, signedIn, load]);

  async function submitDecision(orderId: string, decision: Decision) {
    if (decision === "REPORT_ISSUE" && issueReason.trim().length < 3) {
      showToast("Describe the issue (min 3 characters)");
      return;
    }
    setBusyId(orderId);
    try {
      const res = await fetch("/api/payments/confirm-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protectedTxnId: orderId,
          decision,
          reason:
            decision === "REPORT_ISSUE" ? issueReason.trim() : undefined,
          details:
            decision === "REPORT_ISSUE"
              ? issueDetails.trim() || undefined
              : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not complete");
      if (decision === "RELEASE_NOW") {
        showToast(
          data.transferTriggered
            ? "Residual seller funds released"
            : data.alreadyConfirmed
              ? "Release already processed"
              : "Release completed",
        );
      } else if (decision === "START_INSPECTION") {
        showToast(
          data.alreadyConfirmed
            ? "Inspection already active"
            : "Inspection started — funds stay protected",
        );
      } else if (decision === "ACKNOWLEDGE") {
        showToast(
          data.alreadyConfirmed
            ? "Item already marked received"
            : "Item received — choose release or inspection",
        );
      } else {
        showToast(
          data.alreadyConfirmed
            ? "Issue already open — auto-release frozen"
            : "Issue reported — remaining funds held",
        );
      }
      setIssueId(null);
      setIssueReason("");
      setIssueDetails("");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  async function releaseItemFunds(orderId: string, amountLabel: string) {
    if (
      !window.confirm(
        `Release ${amountLabel} item funds to the sourcer? Shipping and remaining amounts stay protected. This cannot be silently reversed.`,
      )
    ) {
      return;
    }
    setBusyId(orderId);
    try {
      const res = await fetch("/api/payments/release-procurement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protectedTxnId: orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not release item funds");
      showToast(
        data.message ||
          "Item funds released. Remaining amount stays protected.",
      );
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!authReady || !account) {
    return (
      <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
        <Container className="max-w-3xl">
          <p className="text-white/50">Loading…</p>
        </Container>
      </div>
    );
  }

  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-24 text-white">
      <Container className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
          Account
        </p>
        <h1 className="mt-2 font-display text-4xl">Purchases</h1>
        <p className="mt-2 max-w-xl text-sm text-white/55">
          Card payments you funded on Source Bridge. Protected Payment holds
          funds until delivery rules; Direct Payment shows as completed once
          Stripe has released funds to the seller.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link
            href="/profile/settings/payments"
            className="text-electric hover:underline"
          >
            Payments & Payouts
          </Link>
          <Link href="/profile/sales" className="text-electric hover:underline">
            Sales & Fulfilment
          </Link>
          <Link href="/profile/settings" className="text-white/50 hover:underline">
            Settings
          </Link>
        </div>

        {loading ? (
          <p className="mt-10 text-white/50">Loading purchases…</p>
        ) : error ? (
          <p className="mt-10 text-sm text-amber-200/90">{error}</p>
        ) : !orders.length ? (
          <p className="mt-10 text-sm text-white/55">
            No purchases yet.
          </p>
        ) : (
          <ul className="mt-10 space-y-4">
            {orders.map((o) => {
              const residual =
                o.books?.finalResidualMinor ?? 0;
              const procDone =
                o.books?.procurementTransferredMinor ??
                o.procurementTransferredMinor ??
                0;
              const showConfirmReceipt = o.actions.canConfirmReceipt;
              const showPostReceipt =
                o.status === "DELIVERED" && Boolean(o.actions.canReleaseNow);
              const showInsp =
                o.status === "IN_INSPECTION" && Boolean(o.actions.canReleaseNow);
              const showIssueHold = o.status === "DISPUTED";

              return (
              <li
                key={o.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-xl text-white">{o.title}</p>
                    <p className="mt-1 text-sm text-white/55">
                      Seller:{" "}
                      {o.counterparty?.username
                        ? `@${o.counterparty.username}`
                        : o.counterparty?.name || "—"}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-medium text-white">
                      {formatMinor(o.totalChargeMinor, o.currency)}
                    </p>
                    <p className="text-white/45">
                      {o.labels.payment.includes("Direct")
                        ? "Service fee"
                        : "Protection fee"}{" "}
                      {formatMinor(o.protectionFeeMinor, o.currency)}
                    </p>
                  </div>
                </div>
                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-white/40">Payment</dt>
                    <dd className="text-white/85">{o.labels.payment}</dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Shipping</dt>
                    <dd className="text-white/85">{o.labels.shipping}</dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Delivery</dt>
                    <dd className="text-white/85">{o.labels.delivery}</dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Funded</dt>
                    <dd className="text-white/85">{fmtDate(o.fundedAt)}</dd>
                  </div>
                  {procDone > 0 || residual > 0 ? (
                    <div className="sm:col-span-2 space-y-1 text-xs text-white/50">
                      {procDone > 0 ? (
                        <p>
                          Item funds already released:{" "}
                          {formatMinor(procDone, o.currency)}
                        </p>
                      ) : null}
                      {residual > 0 ? (
                        <p>
                          Remaining seller funds protected:{" "}
                          {formatMinor(
                            o.books?.remainingProtectedSellerShareMinor ??
                              residual,
                            o.currency,
                          )}
                        </p>
                      ) : null}
                      <p>
                        Source Bridge fee held:{" "}
                        {formatMinor(
                          o.books?.platformFeeMinor ?? o.protectionFeeMinor,
                          o.currency,
                        )}
                      </p>
                    </div>
                  ) : null}
                  {o.origin === "PRODUCT_CHECKOUT" ? (
                    <div className="sm:col-span-2 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-electric/90">
                        Listed product purchase
                      </p>
                      <p className="text-xs text-white/45">
                        Managed here under Purchases
                        {o.conversationId ? (
                          <>
                            {" · "}
                            <Link
                              href={`/inbox/${o.conversationId}`}
                              className="text-electric hover:underline"
                            >
                              Message seller
                            </Link>
                          </>
                        ) : null}
                        {" · "}
                        not a sourcing Payment Ticket in Inbox
                      </p>
                      {o.listing?.slug ? (
                        <p className="text-xs text-white/55">
                          Listing:{" "}
                          <Link
                            href={`/marketplace/${o.listing.slug}`}
                            className="text-electric hover:underline"
                          >
                            {o.listing.name || o.listing.slug}
                          </Link>
                        </p>
                      ) : null}
                      {o.shipmentPhotoUrl ? (
                        <div className="space-y-1">
                          <p className="text-xs text-white/40">Shipping proof</p>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={o.shipmentPhotoUrl}
                            alt="Shipment proof"
                            className="max-h-40 rounded-lg border border-white/15 object-contain"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {o.origin === "CHAT_TICKET" ? (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-white/45">
                        Sourcing payment ticket
                        {o.conversationId ? (
                          <>
                            {" · "}
                            <Link
                              href={`/inbox/${o.conversationId}`}
                              className="text-electric hover:underline"
                            >
                              Open chat
                            </Link>
                          </>
                        ) : null}
                      </p>
                    </div>
                  ) : null}
                  {o.trackingNumber ? (
                    <>
                      <div>
                        <dt className="text-white/40">Carrier</dt>
                        <dd className="text-white/85">
                          {o.trackingCarrier || "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-white/40">Tracking</dt>
                        <dd className="font-mono text-sm text-white/85">
                          {o.trackingNumber}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-white/40">Shipped</dt>
                        <dd className="text-white/85">{fmtDate(o.shippedAt)}</dd>
                      </div>
                    </>
                  ) : null}
                  {o.inspectionEndsAt && o.status === "IN_INSPECTION" ? (
                    <div>
                      <dt className="text-white/40">Inspection ends</dt>
                      <dd className="text-white/85">
                        {fmtDate(o.inspectionEndsAt)}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {o.actions.canReleaseProcurement ? (
                  <div className="mt-5 border-t border-white/10 pt-4">
                    <PrimaryButton
                      type="button"
                      showArrow={false}
                      disabled={busyId === o.id}
                      className="rounded-lg"
                      onClick={() =>
                        void releaseItemFunds(
                          o.id,
                          formatMinor(o.procurementAdvanceMinor ?? 0, o.currency),
                        )
                      }
                    >
                      {busyId === o.id ? "Releasing…" : "Release Item Funds"}
                    </PrimaryButton>
                    <p className="mt-2 text-xs text-white/40">
                      Authorizes early transfer of item cost only. Shipping and
                      remaining amounts stay protected until delivery.
                    </p>
                  </div>
                ) : null}

                {showConfirmReceipt ? (
                  <div className="mt-5 border-t border-white/10 pt-4">
                    <PrimaryButton
                      type="button"
                      showArrow={false}
                      disabled={busyId === o.id}
                      className="rounded-lg"
                      onClick={() => void submitDecision(o.id, "ACKNOWLEDGE")}
                    >
                      {busyId === o.id ? "Saving…" : "Confirm item received"}
                    </PrimaryButton>
                    <p className="mt-2 text-xs text-white/40">
                      Confirm receipt first. You can then release funds now or
                      start a 12-hour inspection.
                    </p>
                  </div>
                ) : null}

                {showPostReceipt ? (
                  <div className="mt-5 border-t border-white/10 pt-4">
                    <div className="space-y-3 text-sm">
                      <p className="font-medium text-white/90">
                        Item received — choose one
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <PrimaryButton
                          type="button"
                          showArrow={false}
                          disabled={busyId === o.id}
                          className="rounded-lg"
                          onClick={() =>
                            void submitDecision(o.id, "RELEASE_NOW")
                          }
                        >
                          {busyId === o.id ? "Working…" : "Release Funds Now"}
                        </PrimaryButton>
                        <button
                          type="button"
                          disabled={busyId === o.id}
                          onClick={() =>
                            void submitDecision(o.id, "START_INSPECTION")
                          }
                          className="rounded-lg border border-white/25 px-4 py-2 text-sm text-white disabled:opacity-50"
                        >
                          Start 12-Hour Inspection
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {showInsp ||
                (o.status === "IN_INSPECTION" && o.actions.canReportIssue) ? (
                  <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
                    <p className="text-sm text-white/70">
                      Inspection active
                      {o.inspectionEndsAt
                        ? ` until ${fmtDate(o.inspectionEndsAt)}`
                        : ""}
                      . Remaining residual auto-releases after the deadline
                      unless you release early or report a problem.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {showInsp ? (
                        <PrimaryButton
                          type="button"
                          showArrow={false}
                          disabled={busyId === o.id}
                          className="rounded-lg"
                          onClick={() =>
                            void submitDecision(o.id, "RELEASE_NOW")
                          }
                        >
                          {busyId === o.id ? "Releasing…" : "Release Funds Now"}
                        </PrimaryButton>
                      ) : null}
                      {o.actions.canReportIssue ? (
                        <button
                          type="button"
                          disabled={busyId === o.id}
                          onClick={() =>
                            setIssueId(issueId === o.id ? null : o.id)
                          }
                          className="rounded-lg border border-amber-400/40 px-4 py-2 text-sm text-amber-100 disabled:opacity-50"
                        >
                          Report a Problem
                        </button>
                      ) : null}
                    </div>
                    {issueId === o.id ? (
                      <div className="space-y-2 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3">
                        <label className="block text-xs text-white/55">
                          What went wrong?
                          <input
                            value={issueReason}
                            onChange={(e) => setIssueReason(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
                            maxLength={200}
                            disabled={busyId === o.id}
                          />
                        </label>
                        <PrimaryButton
                          type="button"
                          showArrow={false}
                          disabled={
                            busyId === o.id || issueReason.trim().length < 3
                          }
                          className="rounded-lg"
                          onClick={() =>
                            void submitDecision(o.id, "REPORT_ISSUE")
                          }
                        >
                          {busyId === o.id
                            ? "Submitting…"
                            : "Submit issue & hold funds"}
                        </PrimaryButton>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {showIssueHold ? (
                  <p className="mt-5 border-t border-white/10 pt-4 text-sm text-amber-200/90">
                    Issue reported — remaining funds protected; auto-release
                    frozen
                    {procDone > 0
                      ? ` (item funds already released: ${formatMinor(procDone, o.currency)})`
                      : ""}
                    .
                  </p>
                ) : null}
              </li>
            );
            })}
          </ul>
        )}
      </Container>
    </div>
  );
}
