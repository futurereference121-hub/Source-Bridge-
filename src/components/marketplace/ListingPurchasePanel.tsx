"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Listing } from "@/lib/types";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Button } from "@/components/ui/Button";
import { CheckoutOptionsModal } from "@/components/marketplace/CheckoutOptionsModal";
import { ContactSellerButton } from "@/components/marketplace/ContactSellerButton";
import { useAppUi } from "@/components/providers/AppProviders";

type Props = {
  listing: Listing;
  sellerId: string;
  isOwner: boolean;
  memberSlug?: string;
};

function saleStatusLabel(status?: string) {
  switch ((status || "AVAILABLE").toUpperCase()) {
    case "SOLD":
      return "Sold";
    case "RESERVED":
      return "Reserved";
    case "ARCHIVED":
      return "Archived";
    default:
      return "Available";
  }
}

export function ListingPurchasePanel({
  listing,
  sellerId,
  isOwner,
  memberSlug,
}: Props) {
  const router = useRouter();
  const { account, requireAuth, showToast } = useAppUi();
  const [selectedSize, setSelectedSize] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const sizes = listing.sizes || [];
  const needsSize = sizes.length > 0;
  const saleStatus = (listing.saleStatus || "AVAILABLE").toUpperCase();
  const canBuy = saleStatus === "AVAILABLE";
  const ownerSlug =
    memberSlug || account?.slug || account?.username || "";

  async function onDelete() {
    if (
      !window.confirm(
        "Delete this listing permanently? Images will also be removed.",
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/stock/${listing.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete listing");
      showToast("Listing deleted");
      router.push(
        ownerSlug
          ? `/members/${ownerSlug}?tab=listings`
          : "/profile?tab=listings",
      );
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  function onBuyClick() {
    if (!requireAuth("buy this listing")) return;
    if (needsSize && !selectedSize) {
      showToast("Select a size");
      return;
    }
    setCheckoutOpen(true);
  }

  if (isOwner) {
    return (
      <div className="mt-4 space-y-3">
        <p className="text-sm text-white/55">
          You own this listing · {saleStatusLabel(saleStatus)}
        </p>
        <div className="flex flex-wrap gap-3">
          <PrimaryButton
            href={
              ownerSlug
                ? `/members/${ownerSlug}?edit=listing&id=${listing.id}`
                : `/profile?edit=listing&id=${listing.id}`
            }
            showArrow={false}
            className="rounded-lg"
          >
            Edit Listing
          </PrimaryButton>
          <button
            type="button"
            disabled={deleting}
            onClick={() => void onDelete()}
            className="inline-flex h-11 items-center rounded-lg border border-red-400/40 px-5 text-xs font-medium uppercase tracking-[0.14em] text-red-300 transition-colors hover:border-red-400/70 hover:text-red-200 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete Listing"}
          </button>
          <Button
            href={`/marketplace/${listing.slug}`}
            variant="outline"
            className="border-white/25 text-white hover:border-white/50 hover:bg-white/5"
          >
            View Public Preview
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {!canBuy ? (
        <p className="text-sm font-medium text-amber-300/90">
          {saleStatusLabel(saleStatus)} — purchase is unavailable
        </p>
      ) : null}

      {needsSize && canBuy ? (
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.14em] text-white/45">
            Size
          </p>
          <div className="flex flex-wrap gap-2">
            {sizes.map((size) => {
              const active = selectedSize === size;
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => setSelectedSize(size)}
                  className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                    active
                      ? "border-electric/50 bg-electric/15 text-electric"
                      : "border-white/15 text-white/70 hover:border-white/30"
                  }`}
                >
                  {size}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <PrimaryButton
          type="button"
          showArrow={false}
          disabled={!canBuy}
          onClick={onBuyClick}
          className="rounded-lg"
        >
          Buy
        </PrimaryButton>
        {listing.isDbListing ? (
          <ContactSellerButton
            toUserId={sellerId}
            listingId={listing.id}
            listingName={listing.name}
          />
        ) : null}
      </div>

      <CheckoutOptionsModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        listingSlug={listing.slug}
        selectedSize={selectedSize}
        sellerId={sellerId}
        listingId={listing.id}
        listingName={listing.name}
      />
    </div>
  );
}
