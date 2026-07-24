"use client";

import type { Member } from "@/lib/types";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ServiceTag } from "@/components/members/ServiceTag";
import { JourneyGrid } from "@/components/trust/JourneyCard";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { ActivityItem } from "@/components/activity/ActivityItem";
import { Container } from "@/components/ui/Container";
import { getListingsForMember } from "@/data/products";
import { Star } from "lucide-react";

type MemberProfileViewProps = {
  member: Member;
};

export function MemberProfileView({ member }: MemberProfileViewProps) {
  const listings = getListingsForMember(member);
  const countries = member.connectedCountries;

  return (
    <div className="pb-24 md:pb-20">
      <Container>
        <ProfileHeader member={member} />

        <section className="mt-12 max-w-3xl">
          <h2 className="text-xs uppercase tracking-[0.18em] text-muted">
            How I can help
          </h2>
          <p className="mt-3 text-lg leading-relaxed text-ink">{member.howICanHelp}</p>
          <p className="mt-4 text-base leading-relaxed text-muted">{member.bio}</p>
          <p className="mt-4 text-sm text-muted">
            Speaks {member.languages.join(", ")}
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-xs uppercase tracking-[0.18em] text-muted">
            Connected countries
          </h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {countries.map((c) => (
              <li
                key={`${c.country}-${c.kind}`}
                className="border border-border bg-surface px-3 py-2 text-sm text-ink"
              >
                {c.country}
                <span className="ml-2 text-xs uppercase tracking-[0.12em] text-muted">
                  {c.kind}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="text-xs uppercase tracking-[0.18em] text-muted">Services</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {member.services.map((s) => (
              <ServiceTag key={s.id} label={s.label} />
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-muted">
            Journeys
          </h2>
          <JourneyGrid journeys={member.journeys} />
        </section>

        <section className="mt-14">
          <h2 className="text-xs uppercase tracking-[0.18em] text-muted">
            Available finds
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Listings shared by this member — secondary to who they are and where
            they can help.
          </p>
          {listings.length ? (
            <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} member={member} />
              ))}
            </div>
          ) : (
            <p className="mt-6 text-sm text-muted">No finds listed yet.</p>
          )}
        </section>

        <section className="mt-14 grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-xs uppercase tracking-[0.18em] text-muted">Reviews</h2>
            <ul className="mt-4 space-y-4">
              {member.reviews.map((review) => (
                <li key={review.id} className="border border-border bg-surface p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-ink">{review.authorName}</p>
                    <span className="inline-flex items-center gap-1 text-sm text-muted">
                      <Star size={13} className="fill-accent text-accent" />
                      {review.rating.toFixed(1)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-muted">
                    {review.text}
                  </p>
                  <p className="mt-3 text-xs text-muted-light">{review.dateLabel}</p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xs uppercase tracking-[0.18em] text-muted">
              Recent activity
            </h2>
            <ul className="mt-2 border border-border bg-surface px-5">
              {member.recentActivity.map((item) => (
                <ActivityItem key={item.id} item={item} />
              ))}
            </ul>
          </div>
        </section>
      </Container>
    </div>
  );
}
