"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { ContactSellerButton } from "@/components/marketplace/ContactSellerButton";
import { useAppUi } from "@/components/providers/AppProviders";

type Props = {
  open: boolean;
  onClose: () => void;
  listingSlug: string;
  selectedSize?: string;
  sellerId: string;
  listingId: string;
  listingName: string;
  sellerUsername?: string;
  sellerName?: string;
  sellerPhoto?: string;
  sellerLocation?: string;
  listingCover?: string;
  listingPriceLabel?: string;
  isDemo?: boolean;
};

export function CheckoutOptionsModal({
  open,
  onClose,
  listingSlug,
  selectedSize,
  sellerId,
  listingId,
  listingName,
  sellerUsername,
  sellerName,
  sellerPhoto,
  sellerLocation,
  listingCover,
  listingPriceLabel,
  isDemo = false,
}: Props) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { requireAuth, showToast } = useAppUi();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  function go(method: "card" | "crypto") {
    const params = new URLSearchParams({ method });
    if (selectedSize) params.set("size", selectedSize);
    onClose();
    router.push(`/checkout/${listingSlug}?${params.toString()}`);
  }

  function onDemoContact() {
    if (!requireAuth("contact this member")) return;
    onClose();
    showToast(
      "Demo catalogue listings cannot open live messaging. Use Contact Seller on real listings.",
    );
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-auto w-[min(100%,24rem)] rounded-xl border border-white/15 bg-app-navy p-0 text-white shadow-2xl backdrop:bg-black/60"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="px-5 py-6 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
              Checkout
            </p>
            <h2 className="mt-1 font-display text-2xl text-white">
              How would you like to pay?
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs uppercase tracking-[0.14em] text-white/45 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-6 space-y-3">
          <PrimaryButton
            type="button"
            showArrow={false}
            className="w-full rounded-lg"
            onClick={() => go("card")}
          >
            Pay by Card
          </PrimaryButton>
          <button
            type="button"
            onClick={() => go("crypto")}
            className="inline-flex h-12 w-full items-center justify-center rounded-lg border border-white/20 px-5 text-sm font-semibold uppercase tracking-[0.1em] text-white/85 transition-colors hover:border-electric/40 hover:text-white"
          >
            Pay with Cryptocurrency
          </button>
          <div className="pt-1">
            {isDemo ? (
              <button
                type="button"
                onClick={onDemoContact}
                className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-white/25 px-5 text-xs font-medium uppercase tracking-[0.14em] text-white/85 transition-colors hover:border-white/50 hover:bg-white/5"
              >
                Contact Seller
              </button>
            ) : (
              <ContactSellerButton
                toUserId={sellerId}
                toUsername={sellerUsername || "member"}
                toName={sellerName || ""}
                toPhoto={sellerPhoto || ""}
                toLocation={sellerLocation || ""}
                listingId={listingId}
                listingName={listingName}
                listingCover={listingCover}
                listingPriceLabel={listingPriceLabel}
                label="Contact Seller"
              />
            )}
          </div>
        </div>

        <p className="mt-5 text-xs leading-relaxed text-white/45">
          Card marketplace payments are not activated yet (Stripe Connect). The
          Buy interface stays available for future Stripe Connect and escrow
          integration. Crypto and contact options create pending transactions
          only — Source Bridge never auto-marks payment as paid.
        </p>
      </div>
    </dialog>
  );
}
