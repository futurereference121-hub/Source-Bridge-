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
  const { orders, loading, error } = useProtectedOrders({
    role: "buyer",
    enabled: authReady && signedIn,
  });
  const [order, setOrder] = useState<ProtectedOrderSummary | null>(null);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    if (authReady && !signedIn) router.replace("/sign-in");
  }, [authReady, signedIn, router]);

  useEffect(() => {
    const fromList = orders.find((o) => o.id === txnId);
    if (fromList) setOrder(fromList);
  }, [orders, txnId]);

  useEffect(() => {
    if (!authReady || !signedIn || !txnId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/payments/orders?role=buyer&txnId=${encodeURIComponent(txnId)}`,
          { cache: "no-store" },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Order not found");
        if (!cancelled && data.order) setOrder(data.order as ProtectedOrderSummary);
      } catch (err) {
        if (!cancelled) {
          setDetailError(err instanceof Error ? err.message : "Failed to load");
        }
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

  const display = order?.displayState as
    | { label?: string; shortLabel?: string }
    | undefined;

  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-24 text-white">
      <Container className="max-w-3xl">
        <Link
          href="/profile/purchases"
          className="text-sm text-electric hover:underline"
        >
          ← All purchases
        </Link>
        {loading && !order ? (
          <p className="mt-10 text-white/50">Loading order…</p>
        ) : error || detailError || !order ? (
          <p className="mt-10 text-sm text-amber-200/90">
            {detailError || error || "Order not found"}
          </p>
        ) : (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-electric/90">
              {display?.shortLabel || display?.label || "Purchase"}
            </p>
            <h1 className="mt-2 font-display text-3xl">{order.title as string}</h1>
            <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-white/40">Status</dt>
                <dd>{display?.label || String(order.status)}</dd>
              </div>
              <div>
                <dt className="text-white/40">Total</dt>
                <dd>
                  {formatMinor(
                    order.totalChargeMinor as number,
                    String(order.currency),
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-white/40">Funded</dt>
                <dd>{fmtDate(order.fundedAt as string | null)}</dd>
              </div>
              <div>
                <dt className="text-white/40">Shipped</dt>
                <dd>{fmtDate(order.shippedAt as string | null)}</dd>
              </div>
              {order.trackingNumber ? (
                <>
                  <div>
                    <dt className="text-white/40">Carrier</dt>
                    <dd>{String(order.trackingCarrier || "—")}</dd>
                  </div>
                  <div>
                    <dt className="text-white/40">Tracking</dt>
                    <dd className="font-mono">{String(order.trackingNumber)}</dd>
                  </div>
                </>
              ) : null}
            </dl>
            {order.shipmentPhotoUrl ? (
              <div className="mt-4">
                <ViewPhotoControl
                  url={String(order.shipmentPhotoUrl)}
                  alt="Shipment proof"
                  caption="Shipping proof"
                  testId={`purchase-detail-shipment-photo-${order.id}`}
                />
              </div>
            ) : null}
          </div>
        )}
      </Container>
    </div>
  );
}
