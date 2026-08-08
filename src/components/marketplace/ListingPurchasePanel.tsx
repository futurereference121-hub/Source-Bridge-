"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Listing } from "@/lib/types";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Button } from "@/components/ui/Button";
import { CheckoutOptionsModal } from "@/components/marketplace/CheckoutOptionsModal";
import { ContactSellerButton } from "@/components/marketplace/ContactSellerButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { formatPrice } from "@/lib/listings-service";

type Props = {
  listing: Listing;
  sellerId: string;
  isOwner: boolean;
  memberSlug?: string;
  sellerUsername?: string;
  sellerName?: string;
  sellerPhoto?: string;
  sellerLocation?: string;
  /** Seed/prototype listings still show Buy + Contact for buyers. */
  isDemo?: boolean;
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
  sellerUsername,
  sellerName,
  sellerPhoto,
  sellerLocation,
  isDemo = false,
}: Props) {
  const router = useRouter();
  const { account, requireAuth, showToast } = useAppUi();
  const [selectedSize, setSelectedSize] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const sizes =
    listing.sizes?.length
      ? listing.sizes
      : listing.specs?.Sizes
        ? listing.specs.Sizes.split(/[,·|/]/).map((s) => s.trim()).filter(Boolean)
        : [];
  const needsSize = sizes.length > 0 && !sizes.some((s) => /multiple/i.test(s) && sizes.length === 1);
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

  function onDemoContact() {
    if (!requireAuth("contact this member")) return;
    showToast(
      "Demo catalogue listings cannot open live messaging. Contact Seller works on real member listings.",
    );
  }

  return (
    <div className="mt-6 space-y-4 border-t border-white/10 pt-6">
      {isOwner ? (
        <div className="space-y-3">
          <p className="text-sm text-white/55">
            Owner preview · {saleStatusLabel(saleStatus)}
            {isDemo ? " · Demo catalogue" : ""}
          </p>
          <div className="flex flex-wrap gap-3">
            {!isDemo ? (
              <>
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
              </>
            ) : null}
            <Button
              href={`/marketplace/${listing.slug}?preview=1`}
              variant="outline"
              className="border-white/25 text-white hover:border-white/50 hover:bg-white/5"
            >
              View Public Preview
            </Button>
          </div>
        </div>
      ) : null}

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
        {isDemo || !listing.isDbListing ? (
          <button
            type="button"
            onClick={onDemoContact}
            className="inline-flex h-11 items-center rounded-lg border border-white/25 px-5 text-xs font-medium uppercase tracking-[0.14em] text-white/85 transition-colors hover:border-white/50 hover:bg-white/5"
          >
            Contact Seller
          </button>
        ) : (
          <ContactSellerButton
            toUserId={sellerId}
            toUsername={sellerUsername || memberSlug || "member"}
            toName={sellerName || ""}
            toPhoto={sellerPhoto || ""}
            toLocation={sellerLocation || ""}
            listingId={listing.id}
            listingName={listing.name}
            listingCover={listing.images?.[0]}
            listingPriceLabel={formatPrice(listing.price, listing.currency)}
            label="Contact Seller"
          />
        )}
      </div>

      <CheckoutOptionsModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        listingSlug={listing.slug}
        selectedSize={selectedSize}
        sellerId={sellerId}
        listingId={listing.id}
        listingName={listing.name}
        sellerUsername={sellerUsername || memberSlug || "member"}
        sellerName={sellerName || ""}
        sellerPhoto={sellerPhoto || ""}
        sellerLocation={sellerLocation || ""}
        listingCover={listing.images?.[0]}
        listingPriceLabel={formatPrice(listing.price, listing.currency)}
        isDemo={isDemo || !listing.isDbListing}
        protectedPaymentEnabled={listing.protectedPaymentEnabled !== false}
        directPaymentEnabled={Boolean(listing.directPaymentEnabled)}
      />
    </div>
  );
}
