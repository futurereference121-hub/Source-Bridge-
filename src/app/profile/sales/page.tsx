"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { formatMinor } from "@/lib/payments/money";
import { listingProtectedShipmentPhotoRequired } from "@/lib/payments/fulfilment-rules";
import { AddPhotoControl } from "@/components/media/AddPhotoControl";

type Order = {
  id: string;
  status: string;
  paymentOption: string;
  origin?: string;
  title: string;
  currency: string;
  totalChargeMinor: number;
  protectionFeeMinor: number;
  fundedAt: string | null;
  shippedAt: string | null;
  trackingNumber: string;
  trackingCarrier: string;
  trackingStatus: string;
  conversationId?: string | null;
  paymentTicketId?: string | null;
  shipmentPhotoUrl?: string;
  inspectionEndsAt?: string | null;
  procurementTransferredMinor?: number;
  books?: {
    remainingProtectedSellerShareMinor?: number;
    finalResidualMinor?: number;
    procurementTransferredMinor?: number;
  };
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
    canMarkShipped?: boolean;
    canRefreshTracking: boolean;
    canConfirmReceipt: boolean;
  };
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function SalesFulfilmentPage() {
  const router = useRouter();
  const { account, signedIn, authReady, showToast } = useAppUi();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [shipmentPhotoUrl, setShipmentPhotoUrl] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/payments/orders?role=seller", {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load sales");
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

  async function submitTracking(e: FormEvent, orderId: string) {
    e.preventDefault();
    const order = orders.find((o) => o.id === orderId);
    if (
      order &&
      listingProtectedShipmentPhotoRequired({
        origin: order.origin,
        paymentOption: order.paymentOption,
      }) &&
      !shipmentPhotoUrl
    ) {
      showToast("Upload a shipment photo before saving tracking");
      return;
    }
    setBusyId(orderId);
    try {
      const res = await fetch("/api/payments/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protectedTxnId: orderId,
          carrier: carrier.trim() || undefined,
          trackingNumber: trackingNumber.trim(),
          shipmentPhotoUrl: shipmentPhotoUrl || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save tracking");
      showToast("Tracking added — item marked shipped");
      setOpenId(null);
      setCarrier("");
      setTrackingNumber("");
      setShipmentPhotoUrl("");
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
        <h1 className="mt-2 font-display text-4xl">Sales & Fulfilment</h1>
        <p className="mt-2 max-w-xl text-sm text-white/55">
          Sales where you are the seller. Protected Payment requires shipping
          and inspection before release. Direct Payment is released after Stripe
          confirms — tracking is optional and does not control release.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link
            href="/profile/settings/payments"
            className="text-electric hover:underline"
          >
            Payments & Payouts
          </Link>
          <Link href="/profile/purchases" className="text-electric hover:underline">
            Purchases
          </Link>
          <Link href="/profile/settings" className="text-white/50 hover:underline">
            Settings
          </Link>
        </div>

        {loading ? (
          <p className="mt-10 text-white/50">Loading sales…</p>
        ) : error ? (
          <p className="mt-10 text-sm text-amber-200/90">{error}</p>
        ) : !orders.length ? (
          <p className="mt-10 text-sm text-white/55">
            No sales yet. Funded Protected or Direct Payment orders appear here.
          </p>
        ) : (
          <ul className="mt-10 space-y-4">
            {orders.map((o) => (
              <li
                key={o.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-xl text-white">{o.title}</p>
                    <p className="mt-1 text-sm text-white/55">
                      Buyer:{" "}
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
                    <dt className="text-white/40">Status</dt>
                    <dd className="text-white/85">{o.status}</dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Payment</dt>
                    <dd className="text-white/85">{o.labels.payment}</dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Shipping</dt>
                    <dd className="text-white/85">{o.labels.shipping}</dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Funded</dt>
                    <dd className="text-white/85">{fmtDate(o.fundedAt)}</dd>
                  </div>
                  {o.status === "FUNDED" && o.labels.payment.includes("not released") ? (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-white/45">
                        Buyer authorizes item fund release. Sourcers cannot
                        release funds.
                      </p>
                    </div>
                  ) : null}
                  {o.status === "PROCUREMENT_RELEASED" ? (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-white/45">
                        Item funds released
                        {(o.books?.procurementTransferredMinor ??
                          o.procurementTransferredMinor ??
                          0) > 0
                          ? ` (${formatMinor(
                              o.books?.procurementTransferredMinor ??
                                o.procurementTransferredMinor ??
                                0,
                              o.currency,
                            )})`
                          : ""}
                        . Ship when ready; residual
                        {(o.books?.finalResidualMinor ?? 0) > 0
                          ? ` (${formatMinor(o.books!.finalResidualMinor!, o.currency)})`
                          : ""}{" "}
                        pays after buyer decision / inspection (you never release residual).
                      </p>
                    </div>
                  ) : null}
                  {o.status === "AWAITING_SHIPMENT" || o.status === "IN_TRANSIT" ? (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-white/45">
                        Shipped — waiting for buyer confirmation (release now or
                        start inspection). Sellers cannot release residual funds.
                      </p>
                    </div>
                  ) : null}
                  {o.status === "DELIVERED" ? (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-white/45">
                        Delivered — awaiting buyer decision (release now or start
                        inspection). Residual stays protected.
                      </p>
                    </div>
                  ) : null}
                  {o.status === "IN_INSPECTION" ? (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-white/45">
                        Buyer inspection window active
                        {o.inspectionEndsAt
                          ? ` until ${fmtDate(o.inspectionEndsAt)}`
                          : ""}
                        . Buyer may release residual early or report a problem.
                        Auto-release after the window if neither happens.
                      </p>
                    </div>
                  ) : null}
                  {o.status === "DISPUTED" ? (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-amber-200/80">
                        Issue reported — remaining seller funds on hold; auto-release frozen.
                        Already-released item funds are not reclaimed automatically.
                      </p>
                    </div>
                  ) : null}
                  {o.status === "RELEASED" || o.status === "READY_TO_RELEASE" ? (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-white/45">
                        {o.status === "RELEASED"
                          ? "Completed — residual released to your Connect balance (when transfer succeeded)."
                          : "Inspection complete — residual release in progress."}
                      </p>
                    </div>
                  ) : null}
                  {o.origin === "PRODUCT_CHECKOUT" ? (
                    <div className="sm:col-span-2 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-electric/90">
                        Listed product purchase
                      </p>
                      <p className="text-xs text-white/45">
                        Fulfil from Sales & Fulfilment
                        {o.conversationId ? (
                          <>
                            {" · "}
                            <Link
                              href={`/inbox/${o.conversationId}`}
                              className="text-electric hover:underline"
                            >
                              Message buyer
                            </Link>
                          </>
                        ) : null}
                        {" · "}
                        not a sourcing Payment Ticket in Inbox
                      </p>
                      {o.shipmentPhotoUrl ? (
                        <div className="space-y-1">
                          <p className="text-xs text-white/40">Shipping proof on file</p>
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
                  {o.listing?.slug ? (
                    <div>
                      <dt className="text-white/40">Listing</dt>
                      <dd>
                        <Link
                          href={`/marketplace/${o.listing.slug}`}
                          className="text-electric hover:underline"
                        >
                          {o.listing.name || o.listing.slug} (
                          {o.listing.saleStatus || "—"})
                        </Link>
                      </dd>
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
                        <dt className="text-white/40">Date shipped</dt>
                        <dd className="text-white/85">{fmtDate(o.shippedAt)}</dd>
                      </div>
                    </>
                  ) : null}
                </dl>

                {o.actions.canAddTracking || o.actions.canMarkShipped ? (
                  <div className="mt-5 border-t border-white/10 pt-4">
                    {openId === o.id ? (
                      <form
                        className="space-y-3"
                        onSubmit={(e) => void submitTracking(e, o.id)}
                      >
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
                          Add tracking
                        </p>
                        <label className="block text-sm">
                          <span className="text-white/55">Carrier</span>
                          <input
                            value={carrier}
                            onChange={(e) => setCarrier(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-white"
                            placeholder="e.g. DHL, USPS"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="text-white/55">Tracking number</span>
                          <input
                            required
                            minLength={4}
                            value={trackingNumber}
                            onChange={(e) => setTrackingNumber(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 font-mono text-white"
                            placeholder="Tracking number"
                          />
                        </label>
                        {listingProtectedShipmentPhotoRequired({
                          origin: o.origin,
                          paymentOption: o.paymentOption,
                        }) ? (
                          <div className="space-y-2">
                            <p className="text-sm text-white/55">
                              Shipment photo (required)
                            </p>
                            {account?.id ? (
                              <AddPhotoControl
                                userId={account.id}
                                folder="misc"
                                maxCount={1}
                                urls={shipmentPhotoUrl ? [shipmentPhotoUrl] : []}
                                onChange={(next) =>
                                  setShipmentPhotoUrl(next[0] || "")
                                }
                                disabled={busyId === o.id}
                                label="ADD PHOTO"
                                testId="sales-shipment-add-photo"
                              />
                            ) : null}
                            <p className="text-xs text-white/40">
                              {shipmentPhotoUrl
                                ? "Photo attached"
                                : "Photo of the packed item is required for protected listing sales."}
                            </p>
                          </div>
                        ) : null}
                        <p className="text-xs text-white/40">
                          Ship date is recorded automatically. You cannot mark
                          this delivered.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <PrimaryButton
                            type="submit"
                            showArrow={false}
                            disabled={
                              busyId === o.id ||
                              (listingProtectedShipmentPhotoRequired({
                                origin: o.origin,
                                paymentOption: o.paymentOption,
                              }) &&
                                !shipmentPhotoUrl)
                            }
                            className="rounded-lg"
                          >
                            {busyId === o.id ? "Saving…" : "Save tracking"}
                          </PrimaryButton>
                          <button
                            type="button"
                            className="rounded-lg border border-white/20 px-3 py-2 text-xs text-white/70"
                            onClick={() => setOpenId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <PrimaryButton
                        type="button"
                        showArrow={false}
                        className="rounded-lg"
                        onClick={() => {
                          setOpenId(o.id);
                          setCarrier("");
                          setTrackingNumber("");
                          setShipmentPhotoUrl("");
                        }}
                      >
                        Add tracking
                      </PrimaryButton>
                    )}
                  </div>
                ) : o.trackingNumber ? (
                  <p className="mt-4 text-xs font-medium uppercase tracking-[0.12em] text-electric">
                    Shipped
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Container>
    </div>
  );
}
