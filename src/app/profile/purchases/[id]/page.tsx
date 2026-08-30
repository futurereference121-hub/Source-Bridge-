"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { useAppUi } from "@/components/providers/AppProviders";
import { formatMinor } from "@/lib/payments/money";
import { ViewPhotoControl } from "@/components/media/ViewPhotoControl";
import {
  useProtectedOrders,
  type ProtectedOrderSummary,
} from "@/hooks/useProtectedOrders";

type OrderDetail = ProtectedOrderSummary & {
  origin?: string;
  title: string;
  currency: string;
  totalChargeMinor: number;
  protectionFeeMinor: number;
  fundedAt: string | null;
  shippedAt: string | null;
  deliveredAt?: string | null;
  releasedAt?: string | null;
  createdAt?: string | null;
  trackingNumber: string;
  trackingCarrier: string;
  shipmentPhotoUrl?: string;
  conversationId?: string | null;
  labels: { payment: string; shipping: string; delivery: string };
  listing: { id: string; slug: string; name: string; saleStatus: string } | null;
  counterparty: {
    id: string;
    username: string | null;
    name: string;
    slug: string | null;
  } | null;
  books?: {
    finalResidualMinor?: number;
    remainingProtectedSellerShareMinor?: number;
    platformFeeMinor?: number;
  };
  displayState?: {
    phase: string;
    label: string;
    shortLabel: string;
  };
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const txnId = typeof params.id === "string" ? params.id : "";
  const { signedIn, authReady } = useAppUi();
  const { orders, loading: listLoading } = useProtectedOrders({
    role: "buyer",
    enabled: authReady && signedIn,
  });
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    if (authReady && !signedIn) router.replace("/sign-in");
  }, [authReady, signedIn, router]);

  useEffect(() => {
    const fromList = orders.find((o) => o.id === txnId);
    if (fromList) {
      setOrder((prev) => ({ ...(prev || {}), ...fromList }) as OrderDetail);
      setDetailError("");
    }
  }, [orders, txnId]);

  useEffect(() => {
    if (!authReady || !signedIn || !txnId) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError("");
    void (async () => {
      try {
        const res = await fetch(
          `/api/payments/orders?role=buyer&txnId=${encodeURIComponent(txnId)}`,
          { cache: "no-store" },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Order not found");
        if (!data.order) throw new Error("Order not found");
        if (!cancelled) {
          setOrder(data.order as OrderDetail);
          setDetailError("");
        }
      } catch (err) {
        if (!cancelled) {
          setDetailError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, signedIn, txnId]);

  if (!authReady) {
    return (
      <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
        <Container className="max-w-3xl">
          <p className="text-white/50">Loading…</p>
        </Container>
      </div>
    );
  }

  const showLoading = !order && (detailLoading || listLoading);
  const showError = !order && !showLoading;

  const display = order?.displayState;
  const residual =
    order?.books?.finalResidualMinor ??
    order?.books?.remainingProtectedSellerShareMinor ??
    0;
  const feeMinor =
    order?.books?.platformFeeMinor ?? order?.protectionFeeMinor ?? 0;

  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-24 text-white">
      <Container className="max-w-3xl">
        <Link
          href="/profile/purchases"
          className="text-sm text-electric hover:underline"
        >
          ← All purchases
        </Link>
        {showLoading ? (
          <p className="mt-10 text-white/50">Loading order…</p>
        ) : showError ? (
          <p className="mt-10 text-sm text-amber-200/90">
            {detailError || "Order not found"}
          </p>
        ) : order ? (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-electric/90">
              {display?.shortLabel || display?.label || "Purchase"}
            </p>
            <h1 className="mt-2 font-display text-3xl">{order.title}</h1>
            {order.listing?.slug ? (
              <p className="mt-2 text-sm text-white/55">
                Product:{" "}
                <Link
                  href={`/marketplace/${order.listing.slug}`}
                  className="text-electric hover:underline"
                >
                  {order.listing.name || order.listing.slug}
                </Link>
              </p>
            ) : null}
            <p className="mt-1 text-sm text-white/55">
              Seller:{" "}
              {order.counterparty?.username
                ? `@${order.counterparty.username}`
                : order.counterparty?.name || "—"}
            </p>
            <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-white/40">Status</dt>
                <dd className="text-white/85">
                  {display?.label || String(order.status).replace(/_/g, " ")}
                </dd>
              </div>
              <div>
                <dt className="text-white/40">Amount paid</dt>
                <dd className="text-white/85">
                  {formatMinor(order.totalChargeMinor, order.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-white/40">Source Bridge fee</dt>
                <dd className="text-white/85">
                  {formatMinor(feeMinor, order.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-white/40">Payment</dt>
                <dd className="text-white/85">{order.labels.payment}</dd>
              </div>
              <div>
                <dt className="text-white/40">Fulfilment</dt>
                <dd className="text-white/85">{order.labels.shipping}</dd>
              </div>
              <div>
                <dt className="text-white/40">Delivery</dt>
                <dd className="text-white/85">{order.labels.delivery}</dd>
              </div>
              {residual >= 0 ? (
                <div>
                  <dt className="text-white/40">Remaining protected</dt>
                  <dd className="text-white/85">
                    {formatMinor(residual, order.currency)}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-white/40">Date purchased</dt>
                <dd className="text-white/85">
                  {fmtDate(order.fundedAt || order.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="text-white/40">Date shipped</dt>
                <dd className="text-white/85">{fmtDate(order.shippedAt)}</dd>
              </div>
              {order.releasedAt ? (
                <div>
                  <dt className="text-white/40">Completed</dt>
                  <dd className="text-white/85">{fmtDate(order.releasedAt)}</dd>
                </div>
              ) : null}
              {order.trackingNumber ? (
                <>
                  <div>
                    <dt className="text-white/40">Carrier</dt>
                    <dd className="text-white/85">
                      {order.trackingCarrier || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Tracking</dt>
                    <dd className="font-mono text-white/85">
                      {order.trackingNumber}
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>
            {order.shipmentPhotoUrl ? (
              <div className="mt-4">
                <ViewPhotoControl
                  url={order.shipmentPhotoUrl}
                  alt="Shipment proof"
                  caption="Shipping proof"
                  testId={`purchase-detail-shipment-photo-${order.id}`}
                />
              </div>
            ) : null}
            {order.origin === "PRODUCT_CHECKOUT" && order.conversationId ? (
              <p className="mt-4 text-xs text-white/45">
                <Link
                  href={`/inbox/${order.conversationId}`}
                  className="text-electric hover:underline"
                >
                  Message seller
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}
      </Container>
    </div>
  );
}
