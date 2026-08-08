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
  title: string;
  currency: string;
  totalChargeMinor: number;
  protectionFeeMinor: number;
  fundedAt: string | null;
  shippedAt: string | null;
  trackingNumber: string;
  trackingCarrier: string;
  inspectionEndsAt: string | null;
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

export default function PurchasesPage() {
  const router = useRouter();
  const { account, signedIn, authReady, showToast } = useAppUi();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function confirmReceipt(orderId: string) {
    setBusyId(orderId);
    try {
      const res = await fetch("/api/payments/confirm-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protectedTxnId: orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not confirm");
      showToast(
        data.alreadyConfirmed
          ? "Already confirmed — inspection period active"
          : "Receipt confirmed — inspection period started (no funds released yet)",
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
            {orders.map((o) => (
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
                  {o.inspectionEndsAt ? (
                    <div>
                      <dt className="text-white/40">Inspection ends</dt>
                      <dd className="text-white/85">
                        {fmtDate(o.inspectionEndsAt)}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {o.actions.canConfirmReceipt ? (
                  <div className="mt-5 border-t border-white/10 pt-4">
                    <PrimaryButton
                      type="button"
                      showArrow={false}
                      disabled={busyId === o.id}
                      className="rounded-lg"
                      onClick={() => void confirmReceipt(o.id)}
                    >
                      {busyId === o.id
                        ? "Confirming…"
                        : "Confirm item received"}
                    </PrimaryButton>
                    <p className="mt-2 text-xs text-white/40">
                      Starts the inspection period. Seller is not paid until
                      after release rules complete.
                    </p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Container>
    </div>
  );
}
