"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { ProtectedPaymentCheckout } from "@/components/payments/ProtectedPaymentCheckout";
import type { Listing } from "@/lib/types";
import { formatPrice } from "@/lib/listings-service";
import { formatMinor } from "@/lib/payments/money";

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
  canStripeCardCheckout?: boolean;
  canProtectedCheckout?: boolean;
  canDirectCheckout?: boolean;
  cardCheckoutBlockedReason?: string | null;
  protectedBlockedReason?: string | null;
  directBlockedReason?: string | null;
  paymentFlags?: {
    protectedPaymentEnabled?: boolean;
    directPaymentEnabled?: boolean;
  };
  sellerConnectReady?: boolean;
  isDemo?: boolean;
  message?: string | null;
};

type PayMode = "protected" | "direct";

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
  const payFromQuery = (searchParams.get("pay") || "").toLowerCase();
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
  const [payMode, setPayMode] = useState<PayMode | null>(null);
  const [feeBreakdown, setFeeBreakdown] = useState<{
    itemCost: number;
    shipping: number;
    platformFee: number;
    total: number;
    platformFeeLabel: string;
    currency: string;
  } | null>(null);
  const [stripePay, setStripePay] = useState<{
    clientSecret: string;
    publishableKey: string;
    amountMinor: number;
    currency: string;
    protectedTxnId: string;
    mode: PayMode;
  } | null>(null);
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);

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
      const boot = json as CheckoutBootstrap;
      const canP = Boolean(boot.canProtectedCheckout);
      const canD = Boolean(boot.canDirectCheckout);
      if (payFromQuery === "direct") setPayMode("direct");
      else if (payFromQuery === "protected") setPayMode("protected");
      else if (canP && !canD) setPayMode("protected");
      else if (canD && !canP) setPayMode("direct");
      else if (canP) setPayMode("protected");
      else if (canD) setPayMode("direct");
      else setPayMode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [slug, payFromQuery]);

  useEffect(() => {
    if (!authReady) return;
    void load();
  }, [load, authReady, account?.id]);

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

  async function startStripeCheckout(mode: PayMode) {
    if (!requireAuth("complete checkout")) return;
    if (!data) return;
    if (account?.id === data.seller.id) {
      showToast("You cannot buy your own listing");
      return;
    }
    if (mode === "protected" && !data.canProtectedCheckout) {
      showToast(
        data.protectedBlockedReason ||
          "This item is available for Direct Payment only.",
      );
      return;
    }
    if (mode === "direct" && !data.canDirectCheckout) {
      showToast(
        data.directBlockedReason ||
          "This item is available for Protected Payment only.",
      );
      return;
    }

    setBusy(true);
    setStripePay(null);
    setPaymentSubmitted(false);
    setFeeBreakdown(null);
    try {
      const createRes = await fetch("/api/payments/product-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: data.listing.id,
          paymentOption: mode === "direct" ? "DIRECT" : "PROTECTED",
          selectedSize: sizeFromQuery || undefined,
        }),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        throw new Error(
          created.error ||
            (mode === "direct"
              ? "Could not start Direct Payment"
              : "Could not start Protected Payment"),
        );
      }
      const protectedTxnId = String(created.protectedTxnId || "");
      if (!protectedTxnId) {
        throw new Error("Missing protected transaction id");
      }

      const bd = created.breakdown || {};
      const currency = String(created.currency || data.listing.currency || "USD");
      setFeeBreakdown({
        itemCost: Number(bd.itemCost) || 0,
        shipping: Number(bd.shipping) || 0,
        platformFee: Number(bd.platformFee ?? bd.sourceBridgeProtectionFee) || 0,
        total: Number(created.amountMinor) || 0,
        platformFeeLabel:
          bd.labels?.platformFee ||
          bd.labels?.sourceBridgeProtectionFee ||
          (mode === "direct"
            ? "Source Bridge service fee (7%)"
            : "Source Bridge Protection Fee (7%)"),
        currency,
      });

      const piRes = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protectedTxnId,
          // dest_v1 bumps Direct onto Destination Charges (never reuse SCT Direct PIs).
          idempotencyKey: `product-checkout:${protectedTxnId}:${mode === "direct" ? "dest_v1" : "prot_v1"}`,
        }),
      });
      const pi = await piRes.json().catch(() => ({}));
      if (!piRes.ok) {
        throw new Error(pi.error || "Could not create payment");
      }
      if (!pi.clientSecret || !pi.publishableKey) {
        throw new Error("Payment form unavailable");
      }
      setPayMode(mode);
      setStripePay({
        clientSecret: String(pi.clientSecret),
        publishableKey: String(pi.publishableKey),
        amountMinor: Number(pi.amountMinor) || Number(created.amountMinor) || 0,
        currency: String(pi.currency || created.currency || "usd"),
        protectedTxnId,
        mode,
      });
      showToast(
        mode === "direct"
          ? "Enter card details for Direct Payment (TEST)"
          : "Enter your card details to fund the Protected Payment (TEST)",
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  /** Legacy unpaid placeholder order (non-allowlist / crypto / demos). */
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
  const canP = Boolean(data.canProtectedCheckout);
  const canD = Boolean(data.canDirectCheckout);
  const bothAvailable = canP && canD;
  const activeMode: PayMode | null =
    payMode || (canP ? "protected" : canD ? "direct" : null);
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
          {feeBreakdown ? (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-white/45">Item</dt>
                <dd className="text-white/85">
                  {formatMinor(feeBreakdown.itemCost, feeBreakdown.currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-white/45">Shipping</dt>
                <dd className="text-white/85">
                  {formatMinor(feeBreakdown.shipping, feeBreakdown.currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-white/45">{feeBreakdown.platformFeeLabel}</dt>
                <dd className="text-white/85">
                  {formatMinor(feeBreakdown.platformFee, feeBreakdown.currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-white/10 pt-3">
                <dt className="text-white/45">Total</dt>
                <dd className="font-medium text-white">
                  {formatMinor(feeBreakdown.total, feeBreakdown.currency)}
                </dd>
              </div>
            </>
          ) : (
            <div className="flex justify-between gap-4 border-t border-white/10 pt-3">
              <dt className="text-white/45">Item price</dt>
              <dd className="font-medium text-white">
                {formatPrice(listing.price, listing.currency)}
              </dd>
            </div>
          )}
        </dl>

        {method === "card" ? (
          <section className="panel-navy mt-8 rounded-xl px-5 py-6 sm:px-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
              Pay by card
            </h2>
            {(canP || canD) ? (
              <>
                {bothAvailable && !stripePay ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-white/65">
                      This listing accepts both methods. Choose one — no automatic
                      fallback.
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button type="button" onClick={() => setPayMode("protected")}
                        className={`rounded-lg border px-4 py-3 text-left text-sm ${
                          activeMode === "protected"
                            ? "border-electric/50 bg-electric/15 text-white"
                            : "border-white/15 text-white/70 hover:border-white/30"
                        }`}>
                        <span className="font-medium">Protected Payment</span>
                        <span className="mt-1 block text-xs text-white/45">Protection until delivery / inspection</span>
                      </button>
                      <button type="button" onClick={() => setPayMode("direct")}
                        className={`rounded-lg border px-4 py-3 text-left text-sm ${
                          activeMode === "direct"
                            ? "border-electric/50 bg-electric/15 text-white"
                            : "border-white/15 text-white/70 hover:border-white/30"
                        }`}>
                        <span className="font-medium">Direct Payment</span>
                        <span className="mt-1 block text-xs text-white/45">Released after Stripe confirms · no SB protection</span>
                      </button>
                    </div>
                  </div>
                ) : null}
                <p className="mt-3 text-sm leading-relaxed text-white/70">
                  {activeMode === "direct"
                    ? "Direct Payment (Stripe TEST). After Stripe confirms, funds are released to the seller. No Source Bridge inspection hold."
                    : "Protected by Source Bridge (Stripe TEST). Payment is held until protected release rules are met."}
                </p>
                {activeMode ? (
                  <p className="mt-2 text-xs uppercase tracking-[0.14em] text-electric/80">
                    Payment type:{" "}
                    {activeMode === "direct" ? "Direct Payment" : "Protected Payment"}
                  </p>
                ) : null}
                {paymentSubmitted && !stripePay ? (
                  <div className="mt-4 space-y-2">
                    <p className="text-sm text-white/70">
                      Payment received. Seller payout is being processed. Do not
                      pay again.
                    </p>
                    <Link
                      href="/profile/purchases"
                      className="text-sm text-electric hover:text-electric-hover"
                    >
                      View your orders
                    </Link>
                  </div>
                ) : null}
                {stripePay ? (
                  <ProtectedPaymentCheckout
                    clientSecret={stripePay.clientSecret}
                    publishableKey={stripePay.publishableKey}
                    amountMinor={stripePay.amountMinor}
                    currency={stripePay.currency}
                    paymentMode={stripePay.mode}
                    protectedTxnId={stripePay.protectedTxnId}
                    ordersHref="/profile/purchases"
                    returnPath={`/checkout/${encodeURIComponent(slug)}?method=card&pay=${stripePay.mode}&payment=return`}
                    onDismiss={() => {
                      setStripePay(null);
                      setFeeBreakdown(null);
                    }}
                    onPaymentSubmitted={() => {
                      setPaymentSubmitted(true);
                      showToast(
                        "Payment submitted — confirming (do not pay again)",
                      );
                    }}
                  />
                ) : !paymentSubmitted ? (
                  <div className="mt-5">
                    <PrimaryButton
                      type="button"
                      showArrow={false}
                      disabled={busy || !authReady || !account || !activeMode}
                      onClick={() => activeMode && void startStripeCheckout(activeMode)}
                      className="rounded-lg"
                    >
                      {busy ? "Starting checkout…" : activeMode === "direct" ? "Continue with Direct Payment (TEST)" : "Continue with Protected Payment (TEST)"}
                    </PrimaryButton>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="mt-3 text-sm leading-relaxed text-white/70">
                  {isDemo
                    ? "Demo listing — no live card charge is available."
                    : data.cardCheckoutBlockedReason ||
                      "Card checkout is not available for this listing or account."}
                </p>
                {checkoutMessage ? (
                  <p className="mt-3 text-sm text-amber-200/90">
                    {checkoutMessage}
                  </p>
                ) : null}
                {isDemo ? (
                  <p className="mt-3 text-sm text-white/55">
                    Demo listing — checkout options are available for review. No
                    live marketplace transaction is created.
                  </p>
                ) : null}
                {transactionId || demoPreviewDone ? (
                  <div className="mt-5 space-y-3">
                    {transactionId ? (
                      <p className="text-sm text-white/55">
                        Pending unpaid order created. Reference:{" "}
                        <span className="font-mono text-white/80">
                          {transactionId}
                        </span>
                      </p>
                    ) : (
                      <p className="text-sm text-white/55">
                        Demo preview recorded. No payment was taken and no pending
                        database order was created.
                      </p>
                    )}
                    <PrimaryButton
                      href="/inbox"
                      showArrow={false}
                      className="rounded-lg"
                    >
                      Open inbox
                    </PrimaryButton>
                  </div>
                ) : isDemo ? (
                  <div className="mt-5">
                    <PrimaryButton
                      type="button"
                      showArrow={false}
                      disabled={busy}
                      onClick={() => void createPendingCheckout()}
                      className="rounded-lg"
                    >
                      {busy ? "Creating…" : "Preview pending order"}
                    </PrimaryButton>
                  </div>
                ) : null}
              </>
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
