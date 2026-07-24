import Image from "next/image";
import Link from "next/link";
import type { Listing, Member } from "@/lib/types";
import { availabilityLabel, formatPrice } from "@/data/products";
import { getMemberById } from "@/data/members";
import { BadgeCheck } from "lucide-react";

type ListingCardProps = {
  listing: Listing;
  member?: Member;
  priority?: boolean;
};

export function ListingCard({
  listing,
  member: memberProp,
  priority = false,
}: ListingCardProps) {
  const member = memberProp ?? getMemberById(listing.memberId);

  return (
    <Link
      href={`/marketplace/${listing.slug}`}
      className="group flex flex-col outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-stone">
        <Image
          src={listing.images[0]}
          alt={listing.name}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          priority={priority}
        />
      </div>
      <div className="flex flex-1 flex-col pt-4">
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted">
          {listing.subcategory ?? listing.category}
        </p>
        <h3 className="mt-1.5 font-display text-xl leading-snug text-ink sm:text-2xl">
          {listing.name}
        </h3>

        {member ? (
          <div className="mt-3 flex items-center gap-3">
            <div className="relative h-8 w-8 shrink-0 overflow-hidden bg-stone">
              <Image
                src={member.photo}
                alt={member.displayName}
                fill
                sizes="32px"
                className="object-cover"
              />
            </div>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
                <span className="truncate">{member.displayName}</span>
                {member.badges.some((b) => b.kind === "verified_identity") ? (
                  <BadgeCheck
                    size={14}
                    strokeWidth={1.5}
                    className="shrink-0 text-accent"
                    aria-label="Verified identity placeholder"
                  />
                ) : null}
              </p>
              <p className="text-xs text-muted">
                {listing.country}
                <span className="mx-1.5 text-border">·</span>
                {listing.currentLocation}
              </p>
            </div>
          </div>
        ) : null}

        <p className="mt-2 text-xs text-muted">
          {listing.shippingAvailable ? "Shipping available" : "Local arrangement"}
        </p>

        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <p className="text-sm font-medium text-ink">
            {formatPrice(listing.price, listing.currency)}
          </p>
          <p className="text-xs text-muted">
            {availabilityLabel(listing.availability)}
          </p>
        </div>
      </div>
    </Link>
  );
}

/** @deprecated Prefer ListingCard */
export { ListingCard as ProductCard };
