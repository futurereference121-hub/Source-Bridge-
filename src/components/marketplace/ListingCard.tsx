"use client";

import Image from "next/image";
import Link from "next/link";
import type { Listing, Member } from "@/lib/types";
import { getMemberById, getMemberForListing } from "@/data/members";
import { availabilityLabel, formatPrice } from "@/data/products";
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
  const member =
    memberProp ?? getMemberForListing(listing) ?? getMemberById(listing.memberId);

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
                alt={member.fullName}
                fill
                sizes="32px"
                className="object-cover"
              />
            </div>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
                <span className="truncate">@{member.username}</span>
                {member.verification.identityVerified ? (
                  <BadgeCheck
                    size={14}
                    className="shrink-0 text-accent"
                    strokeWidth={1.5}
                  />
                ) : null}
              </p>
              <p className="truncate text-xs text-muted">
                {listing.currentLocation}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted">{listing.currentLocation}</p>
        )}

        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <p className="font-display text-xl text-ink">
            {formatPrice(listing.price, listing.currency)}
          </p>
          <p className="text-xs uppercase tracking-[0.12em] text-muted">
            {availabilityLabel(listing.availability)}
          </p>
        </div>
      </div>
    </Link>
  );
}
