"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import type { Listing, Member } from "@/lib/types";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { Container } from "@/components/ui/Container";
import { getListingsForMember } from "@/data/products";
import { isStatusActive } from "@/lib/member-status";
import { getLocationSuggestions } from "@/data/location-suggestions";
import { useAppUi } from "@/components/providers/AppProviders";

type MemberProfileViewProps = {
  member: Member;
  isOwner: boolean;
  listings?: Listing[];
};

export function MemberProfileView({
  member,
  isOwner,
  listings = getListingsForMember(member),
}: MemberProfileViewProps) {
  const router = useRouter();
  const { showToast } = useAppUi();
  const statusActive = isStatusActive(member.status);
  const opportunities = member.opportunities?.length
    ? member.opportunities
    : member.opportunity
      ? [member.opportunity]
      : [];
  const suggestions = opportunities[0]
    ? getLocationSuggestions(
        opportunities[0].city,
        opportunities[0].country,
        opportunities[0].cityCode,
        opportunities[0].countryCode,
      )
    : [];

  useEffect(() => {
    if (!isOwner) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome") !== "1") return;
    showToast("Your Source Bridge profile is ready.");
    router.replace(`/members/${member.slug}`, { scroll: false });
  }, [isOwner, member.slug, router, showToast]);

  return (
    <div className="bg-app-navy pb-28 text-white md:pb-24">
      <Container>
        <ProfileHeader member={member} isOwner={isOwner} />

        <div className="mt-10 space-y-5 sm:mt-12 sm:space-y-6">
          <div className="grid gap-5 md:grid-cols-2 md:gap-6">
            <ProfilePanel title="Current Location">
              <p className="text-lg text-white">{member.location.label}</p>
            </ProfilePanel>

            <ProfilePanel title="Upcoming Travels">
              {member.trips.length ? (
                <ul className="space-y-3">
                  {member.trips.map((trip) => (
                    <li key={trip.id} className="text-base text-white/90">
                      <span>
                        {trip.city}
                        {trip.country && trip.country !== "—"
                          ? `, ${trip.country}`
                          : ""}
                      </span>
                      <span className="mt-0.5 block text-sm text-white/45">
                        {trip.dateRange}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyCopy>No upcoming travel added.</EmptyCopy>
              )}
              {isOwner ? (
                <OwnerLink href="/profile#trips">Manage Trips</OwnerLink>
              ) : null}
            </ProfilePanel>
          </div>

          <div className="grid gap-5 md:grid-cols-2 md:gap-6">
            <ProfilePanel title="Status">
              {statusActive && member.status ? (
                <p className="text-base leading-snug text-white/90">
                  {member.status.text}
                </p>
              ) : (
                <EmptyCopy>No active status.</EmptyCopy>
              )}
              {isOwner ? (
                <OwnerLink href="/profile#status">Edit Status</OwnerLink>
              ) : null}
            </ProfilePanel>

            <ProfilePanel title="Submit Opportunity">
              {opportunities.length ? (
                <div className="space-y-5">
                  {opportunities.map((opportunity) => (
                  <div key={opportunity.id}>
                  <p className="text-base font-medium leading-snug text-white/90">
                    {opportunity.title || opportunity.summary}
                  </p>
                  {opportunity.description ? (
                    <p className="mt-1.5 text-sm leading-relaxed text-white/55">{opportunity.description}</p>
                  ) : null}
                  <dl className="mt-4 space-y-2 text-sm text-white/55">
                    {opportunity.availability ? (
                      <Detail
                        label="Availability"
                        value={opportunity.availability}
                      />
                    ) : null}
                    {opportunity.travel ? (
                      <Detail label="Travel" value={opportunity.travel} />
                    ) : null}
                    {opportunity.localAccess ? (
                      <Detail
                        label="Local access"
                        value={opportunity.localAccess}
                      />
                    ) : null}
                    {opportunity.stock ? (
                      <Detail label="Stock" value={opportunity.stock} />
                    ) : null}
                    {opportunity.categories.length ? (
                      <Detail
                        label="Categories"
                        value={opportunity.categories.join(" · ")}
                      />
                    ) : null}
                  </dl>
                  {suggestions.length ? (
                    <p className="mt-4 text-xs text-white/35">
                      Known for this place: {suggestions.join(" · ")}
                    </p>
                  ) : null}
                  </div>
                  ))}
                </div>
              ) : (
                <EmptyCopy>No opportunity submitted.</EmptyCopy>
              )}
              {isOwner ? (
                <OwnerLink href="/profile#opportunities">
                  Add Opportunity
                </OwnerLink>
              ) : null}
            </ProfilePanel>
          </div>

          <ProfilePanel title="Network Reach">
            {member.network.length ? (
              <ul className="flex flex-wrap gap-2">
                {member.network.map((n) => (
                  <li
                    key={`${n.city}-${n.country}`}
                    className="rounded-lg border border-white/12 bg-white/[0.04] px-3 py-1.5 text-sm text-white/80"
                  >
                    {n.city}
                    <span className="text-white/40"> · {n.country}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyCopy>No network locations added.</EmptyCopy>
            )}
          </ProfilePanel>

          <ProfilePanel title="Available Stock">
            {listings.length ? (
              <StockThumbnails listings={listings} />
            ) : (
              <EmptyCopy>No stock listed yet.</EmptyCopy>
            )}
            {isOwner ? (
              <Link
                href="/profile#stock"
                className="mt-4 inline-flex text-xs uppercase tracking-[0.14em] text-electric hover:text-electric-hover"
              >
                Manage stock
              </Link>
            ) : null}
          </ProfilePanel>

          <ProfilePanel title="Reviews">
            {member.reviews.length ? (
              <ReviewsCarousel reviews={member.reviews} />
            ) : (
              <EmptyCopy>No reviews yet.</EmptyCopy>
            )}
          </ProfilePanel>
        </div>
      </Container>
    </div>
  );
}

function ProfilePanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="panel-navy rounded-xl px-5 py-5 sm:px-6 sm:py-6">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
        {title}
      </h2>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function EmptyCopy({ children }: { children: ReactNode }) {
  return <p className="text-sm text-white/40">{children}</p>;
}

function OwnerLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="mt-4 inline-flex text-xs uppercase tracking-[0.14em] text-electric hover:text-electric-hover"
    >
      {children}
    </Link>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-xs uppercase tracking-[0.12em] text-white/35 sm:w-28">
        {label}
      </dt>
      <dd className="text-white/80">{value}</dd>
    </div>
  );
}

function StockThumbnails({
  listings,
}: {
  listings: Listing[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? listings : listings.slice(0, 6);

  return (
    <div>
      <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1.5">
        {visible.map((listing) => (
          <Link
            key={listing.id}
            href={`/marketplace/${listing.slug}`}
            className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-navy-mid ring-1 ring-white/10 sm:h-[72px] sm:w-[72px]"
          >
            <Image
              src={listing.images[0]}
              alt={listing.name}
              fill
              sizes="72px"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </Link>
        ))}
      </div>
      {listings.length > 6 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-xs uppercase tracking-[0.14em] text-electric hover:text-electric-hover"
        >
          {expanded ? "Show less" : `Show all ${listings.length}`}
        </button>
      ) : null}
    </div>
  );
}

function ReviewsCarousel({
  reviews,
}: {
  reviews: Member["reviews"];
}) {
  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 snap-x snap-mandatory">
      {reviews.map((review) => (
        <article
          key={review.id}
          className="w-[min(100%,280px)] shrink-0 snap-start rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-white">{review.authorName}</p>
            <span className="inline-flex items-center gap-1 text-sm text-white/55">
              <Star size={13} className="fill-electric text-electric" />
              {review.rating.toFixed(1)}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/60">
            {review.text}
          </p>
          <p className="mt-3 text-xs text-white/30">{review.dateLabel}</p>
        </article>
      ))}
    </div>
  );
}
