"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import type { Listing } from "@/lib/types";
import { formatPrice } from "@/lib/listings-service";

type SellerInfo = {
  id: string;
  name: string;
  username: string | null;
  slug: string | null;
  photo: string;
};

type CryptoMethod = {
  id: string;
  kind: string;
  networkName: string;
  address: string;
  qrImageUrl: string;
  instructions: string;
};

type CheckoutBootstrap = {
  listing: Listing;
  seller: SellerInfo;
  cryptoPaymentMethods: CryptoMethod[];
  stripeConfigured: boolean;
  isDemo?: boolean;
  message?: string | null;
};

type Props = {
  slug: string;
};

export function CheckoutPageClient({ slug }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const method = (searchParams.get("method") || "card") as
    | "card"
    | "crypto"
    | "contact";
  const sizeFromQuery = searchParams.get("size") || "";

  const { account, authReady, requireAuth, showToast } = useAppUi();
  const [data, setData] = useState<CheckoutBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMethodId, setSelectedMethodId] = useState("");
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);
  const [hashSubmitted, setHashSubmitted] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [demoPreviewDone, setDemoPreviewDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/checkout/listing/${encodeURIComponent(slug)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Listing not found");
      setData(json as CheckoutBootstrap);
      setIsDemo(Boolean((json as CheckoutBootstrap).isDemo));
      if ((json as CheckoutBootstrap).message) {
        setCheckoutMessage((json as CheckoutBootstrap).message || null);
      }
      const methods = (json as CheckoutBootstrap).cryptoPaymentMethods || [];
      if (methods.length) setSelectedMethodId(methods[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedCrypto = useMemo(
    () =>
      data?.cryptoPaymentMethods.find((m) => m.id === selectedMethodId) || null,
    [data, selectedMethodId],
  );

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      showToast("Address copied");
    } catch {
      showToast("Could not copy address");
    }
  }

  async function createPendingCheckout() {
    if (!requireAuth("complete checkout")) return;
    if (!data) return;
    if (account?.id === data.seller.id) {
      showToast("You cannot buy your own listing");
      return;
    }
    if (method === "crypto" && !selectedMethodId) {
      showToast("Select a crypto network");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: data.listing.id,
          paymentMethod: method === "crypto" ? "crypto" : "card",
          selectedSize: sizeFromQuery || undefined,
          paymentMethodId:
            method === "crypto" ? selectedMethodId : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Checkout failed");
      setTransactionId(json.transaction?.id || null);
      setCheckoutMessage(json.checkout?.message || null);
      if (json.demo) {
        setDemoPreviewDone(true);
        showToast("Demo checkout preview — no live order created");
      } else {
        showToast(
          method === "card"
            ? "Pending unpaid order created"
            : "Crypto order created — send payment then submit hash",
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitHash() {
    if (!transactionId) {
      showToast("Create the order first");
      return;
    }
    if (!txHash.trim()) {
      showToast("Enter your transaction hash");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/checkout/${transactionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cryptoTransactionHash: txHash.trim(),
          buyerConfirmed: true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not submit hash");
      setHashSubmitted(true);
      showToast("Hash submitted — awaiting seller confirmation");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  if (!authReady || loading) {
    return (
      <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
        <Container className="max-w-2xl">
          <p className="text-white/50">Loading checkout…</p>
        </Container>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
        <Container className="max-w-2xl">
          <p className="text-white/70">{error || "Listing not found"}</p>
          <Link
            href="/explore"
            className="mt-4 inline-block text-sm text-electric hover:text-electric-hover"
          >
            Back to explore
          </Link>
        </Container>
      </div>
    );
  }

  const { listing, seller } = data;
  const cover = listing.images[0] || "";
  const shippedFrom =
    listing.shipFromCity && listing.shipFromCountry
      ? `${listing.shipFromCity}, ${listing.shipFromCountry}`
      : listing.currentLocation || listing.country || "—";

  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-24 text-white">
      <Container className="max-w-2xl">
        <nav className="mb-8 text-xs uppercase tracking-[0.14em] text-white/45">
          <Link href={`/marketplace/${listing.slug}`} className="hover:text-white">
            Listing
          </Link>
          <span className="mx-2">/</span>
          <span className="text-white/80">Checkout</span>
        </nav>

        <div className="flex gap-5">
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-white/5">
            {cover ? (
              <Image
                src={cover}
                alt={listing.name}
                fill
                className="object-cover"
                sizes="96px"
              />
            ) : null}
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-3xl text-white sm:text-4xl">
              {listing.name}
            </h1>
            <p className="mt-2 text-lg font-medium text-white">
              {formatPrice(listing.price, listing.currency)}
            </p>
            <p className="mt-1 text-sm text-white/55">Seller: {seller.name}</p>
          </div>
        </div>

        <dl className="mt-8 space-y-3 border-t border-white/10 pt-6 text-sm">
          {sizeFromQuery ? (
            <div className="flex justify-between gap-4">
              <dt className="text-white/45">Size</dt>
              <dd className="text-white/85">{sizeFromQuery}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4">
            <dt className="text-white/45">Shipped from</dt>
            <dd className="text-right text-white/85">{shippedFrom}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-white/10 pt-3">
            <dt className="text-white/45">Total</dt>
            <dd className="font-medium text-white">
              {formatPrice(listing.price, listing.currency)}
            </dd>
          </div>
        </dl>

        {method === "card" ? (
          <section className="panel-navy mt-8 rounded-xl px-5 py-6 sm:px-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
              Pay by card
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              Card checkout is not yet activated. Stripe Connect marketplace
              payouts are not configured for Source Bridge. No payment will be
              taken.
            </p>
            {checkoutMessage ? (
              <p className="mt-3 text-sm text-amber-200/90">{checkoutMessage}</p>
            ) : null}
            {isDemo ? (
              <p className="mt-3 text-sm text-white/55">
                Demo listing — checkout options are available for review. No live
                marketplace transaction is created.
              </p>
            ) : null}
            {transactionId || demoPreviewDone ? (
              <div className="mt-5 space-y-3">
                {transactionId ? (
                  <p className="text-sm text-white/55">
                    Pending unpaid order created. Reference:{" "}
                    <span className="font-mono text-white/80">{transactionId}</span>
                  </p>
                ) : (
                  <p className="text-sm text-white/55">
                    Demo preview recorded. No payment was taken and no pending
                    database order was created.
                  </p>
                )}
                <p className="text-xs text-white/40">
                  This is not a successful payment. Contact the seller or wait
                  until card checkout is enabled.
                </p>
                <PrimaryButton
                  href="/messages"
                  showArrow={false}
                  className="rounded-lg"
                >
                  Open messages
                </PrimaryButton>
              </div>
            ) : (
              <div className="mt-5">
                <PrimaryButton
                  type="button"
                  showArrow={false}
                  disabled={busy}
                  onClick={() => void createPendingCheckout()}
                  className="rounded-lg"
                >
                  {busy
                    ? "Creating…"
                    : isDemo
                      ? "Preview pending order"
                      : "Create pending order"}
                </PrimaryButton>
              </div>
            )}
          </section>
        ) : null}

        {method === "crypto" ? (
          <section className="panel-navy mt-8 rounded-xl px-5 py-6 sm:px-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
              Pay with cryptocurrency
            </h2>
            {!data.cryptoPaymentMethods.length ? (
              <div className="mt-3 space-y-4">
                <p className="text-sm text-white/60">
                  {isDemo
                    ? "Demo sellers do not have live crypto wallets. The crypto checkout layout is available for review — no payment is taken."
                    : "This seller has not enabled any crypto payment methods yet. Contact them to arrange payment."}
                </p>
                {isDemo && !demoPreviewDone ? (
                  <PrimaryButton
                    type="button"
                    showArrow={false}
                    disabled={busy}
                    onClick={() => void createPendingCheckout()}
                    className="rounded-lg"
                  >
                    {busy ? "Creating…" : "Preview crypto checkout"}
                  </PrimaryButton>
                ) : null}
                {demoPreviewDone ? (
                  <p className="text-sm text-white/55">
                    Demo preview recorded. No live crypto order was created.
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                <div className="mt-4 space-y-2">
                  {data.cryptoPaymentMethods.map((m) => {
                    const active = selectedMethodId === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelectedMethodId(m.id)}
                        className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                          active
                            ? "border-electric/50 bg-electric/10 text-white"
                            : "border-white/15 text-white/70 hover:border-white/30"
                        }`}
                      >
                        <span>{m.networkName}</span>
                        {active ? (
                          <span className="text-[10px] uppercase tracking-[0.12em] text-electric">
                            Selected
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                {selectedCrypto ? (
                  <div className="mt-5 space-y-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-white/45">
                        Wallet address
                      </p>
                      <p className="mt-2 break-all font-mono text-sm text-white/85">
                        {selectedCrypto.address}
                      </p>
                      <button
                        type="button"
                        onClick={() => void copyAddress(selectedCrypto.address)}
                        className="mt-2 text-xs uppercase tracking-[0.14em] text-electric hover:text-electric-hover"
                      >
                        Copy address
                      </button>
                    </div>
                    {selectedCrypto.qrImageUrl ? (
                      <div className="relative h-40 w-40 overflow-hidden rounded-lg bg-white">
                        <Image
                          src={selectedCrypto.qrImageUrl}
                          alt={`${selectedCrypto.networkName} QR`}
                          fill
                          className="object-contain p-2"
                          sizes="160px"
                        />
                      </div>
                    ) : null}
                    {selectedCrypto.instructions ? (
                      <p className="text-sm leading-relaxed text-white/60">
                        {selectedCrypto.instructions}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {checkoutMessage ? (
                  <p className="mt-4 text-sm text-amber-200/90">{checkoutMessage}</p>
                ) : null}

                {!transactionId ? (
                  <div className="mt-5">
                    <PrimaryButton
                      type="button"
                      showArrow={false}
                      disabled={busy || !selectedMethodId}
                      onClick={() => void createPendingCheckout()}
                      className="rounded-lg"
                    >
                      {busy ? "Creating…" : "Create pending crypto order"}
                    </PrimaryButton>
                  </div>
                ) : (
                  <div className="mt-5 space-y-3 border-t border-white/10 pt-5">
                    <p className="text-sm text-white/55">
                      Order{" "}
                      <span className="font-mono text-white/80">
                        {transactionId}
                      </span>{" "}
                      — status awaiting confirmation (not paid).
                    </p>
                    <label className="block">
                      <span className="text-xs uppercase tracking-[0.14em] text-white/45">
                        Transaction hash
                      </span>
                      <input
                        className="mt-2 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2.5 text-sm text-white outline-none focus:border-electric/50"
                        value={txHash}
                        onChange={(e) => setTxHash(e.target.value)}
                        placeholder="Paste your tx hash after sending"
                        disabled={hashSubmitted || busy}
                      />
                    </label>
                    <PrimaryButton
                      type="button"
                      showArrow={false}
                      disabled={busy || hashSubmitted || !txHash.trim()}
                      onClick={() => void submitHash()}
                      className="rounded-lg"
                    >
                      {hashSubmitted
                        ? "Hash submitted"
                        : busy
                          ? "Submitting…"
                          : "Submit hash"}
                    </PrimaryButton>
                    {hashSubmitted ? (
                      <p className="text-xs text-white/45">
                        Your hash was recorded. Payment stays awaiting seller
                        confirmation — Source Bridge will not mark this paid
                        automatically.
                      </p>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </section>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-4">
          <button
            type="button"
            onClick={() => router.push(`/marketplace/${listing.slug}`)}
            className="text-xs uppercase tracking-[0.14em] text-white/45 hover:text-white"
          >
            Back to listing
          </button>
        </div>
      </Container>
    </div>
  );
}
