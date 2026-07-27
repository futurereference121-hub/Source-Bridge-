"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Star } from "lucide-react";
import type { Listing, Member } from "@/lib/types";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import {
  ProfileTabs,
  parseProfileTab,
} from "@/components/profile/ProfileTabs";
import { ProfileEditHost } from "@/components/profile/ProfileEditHost";
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

export function MemberProfileView(props: MemberProfileViewProps) {
  return (
    <Suspense fallback={<MemberProfileFallback {...props} />}>
      <MemberProfileViewInner {...props} />
    </Suspense>
  );
}

function MemberProfileFallback({
  member,
  isOwner,
  listings = getListingsForMember(member),
}: MemberProfileViewProps) {
  return (
    <div className="bg-app-navy pb-28 text-white md:pb-24">
      <Container>
        <ProfileHeader member={member} isOwner={isOwner} />
        <ProfileTabs slug={member.slug} isOwner={isOwner} active="public" />
        <div className="mt-10 space-y-5 sm:mt-12 sm:space-y-6">
          <PublicProfilePanels
            member={member}
            isOwner={isOwner}
            listings={listings}
          />
        </div>
      </Container>
    </div>
  );
}

function MemberProfileViewInner({
  member,
  isOwner,
  listings = getListingsForMember(member),
}: MemberProfileViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useAppUi();
  const activeTab = parseProfileTab(searchParams.get("tab"), isOwner);

  useEffect(() => {
    if (!isOwner) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome") !== "1") return;
    showToast("Your Source Bridge profile is ready.");
    const next = new URLSearchParams(params);
    next.delete("welcome");
    const qs = next.toString();
    router.replace(qs ? `/members/${member.slug}?${qs}` : `/members/${member.slug}`, {
      scroll: false,
    });
  }, [isOwner, member.slug, router, showToast]);

  return (
    <div className="bg-app-navy pb-28 text-white md:pb-24">
      <Container>
        <ProfileHeader member={member} isOwner={isOwner} />
        <ProfileTabs slug={member.slug} isOwner={isOwner} active={activeTab} />

        <div className="mt-10 space-y-5 sm:mt-12 sm:space-y-6">
          {activeTab === "public" ? (
            <PublicProfilePanels
              member={member}
              isOwner={isOwner}
              listings={listings}
            />
          ) : null}

          {activeTab === "activity" && isOwner ? (
            <ActivityTab member={member} />
          ) : null}

          {activeTab === "listings" ? (
            <ListingsTab
              listings={listings}
              isOwner={isOwner}
              slug={member.slug}
            />
          ) : null}

          {activeTab === "messages" && isOwner ? <MessagesTab /> : null}

          {activeTab === "reviews" ? (
            <ProfilePanel title="Reviews">
              {member.reviews.length ? (
                <ReviewsCarousel reviews={member.reviews} />
              ) : (
                <EmptyCopy>No reviews yet.</EmptyCopy>
              )}
            </ProfilePanel>
          ) : null}

          {activeTab === "settings" && isOwner ? (
            <SettingsTab />
          ) : null}
        </div>

        {isOwner ? <ProfileEditHost member={member} /> : null}
      </Container>
    </div>
  );
}

function PublicProfilePanels({
  member,
  isOwner,
  listings,
}: {
  member: Member;
  isOwner: boolean;
  listings: Listing[];
}) {
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

  return (
    <>
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
            <OwnerLink href={`/members/${member.slug}?edit=travel`}>
              Manage Trips
            </OwnerLink>
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
            <OwnerLink href={`/members/${member.slug}?edit=status`}>
              Edit Status
            </OwnerLink>
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
                    <p className="mt-1.5 text-sm leading-relaxed text-white/55">
                      {opportunity.description}
                    </p>
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
                  {isOwner ? (
                    <OwnerLink
                      href={`/members/${member.slug}?edit=opportunity&id=${opportunity.id}`}
                    >
                      Edit Opportunity
                    </OwnerLink>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyCopy>No opportunity submitted.</EmptyCopy>
          )}
          {isOwner ? (
            <OwnerLink href={`/members/${member.slug}?edit=opportunity`}>
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
          <OwnerLink href={`/members/${member.slug}?edit=listing`}>
            Manage stock
          </OwnerLink>
        ) : null}
      </ProfilePanel>

      <ProfilePanel title="Reviews">
        {member.reviews.length ? (
          <ReviewsCarousel reviews={member.reviews} />
        ) : (
          <EmptyCopy>No reviews yet.</EmptyCopy>
        )}
      </ProfilePanel>
    </>
  );
}

function ActivityTab({ member }: { member: Member }) {
  const statusActive = isStatusActive(member.status);
  const opportunities = member.opportunities?.length
    ? member.opportunities
    : member.opportunity
      ? [member.opportunity]
      : [];

  const items: { id: string; kind: string; title: string; detail: string }[] =
    [];

  if (statusActive && member.status) {
    items.push({
      id: "status",
      kind: "Status",
      title: member.status.text,
      detail: `Active until ${new Date(member.status.expiresAt).toLocaleString()}`,
    });
  }

  for (const opp of opportunities) {
    items.push({
      id: opp.id,
      kind: "Opportunity",
      title: opp.title || opp.summary,
      detail: [opp.city, opp.country].filter(Boolean).join(", "),
    });
  }

  return (
    <ProfilePanel title="Activity">
      {items.length ? (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-electric/80">
                {item.kind}
              </p>
              <p className="mt-1 text-sm text-white/90">{item.title}</p>
              {item.detail ? (
                <p className="mt-1 text-xs text-white/40">{item.detail}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyCopy>No recent status or opportunities.</EmptyCopy>
      )}
      <div className="mt-4 flex flex-wrap gap-4">
        <OwnerLink href={`/members/${member.slug}?edit=status`} className="">
          Update Status
        </OwnerLink>
        <OwnerLink href={`/members/${member.slug}?edit=opportunity`} className="">
          Post Opportunity
        </OwnerLink>
      </div>
    </ProfilePanel>
  );
}

function ListingsTab({
  listings,
  isOwner,
  slug,
}: {
  listings: Listing[];
  isOwner: boolean;
  slug: string;
}) {
  return (
    <ProfilePanel title="Listings">
      {listings.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {listings.map((listing) => (
            <div key={listing.id} className="group relative">
              <Link
                href={`/marketplace/${listing.slug}`}
                className="relative block aspect-square overflow-hidden rounded-lg bg-navy-mid ring-1 ring-white/10"
              >
                <Image
                  src={listing.images[0]}
                  alt={listing.name}
                  fill
                  sizes="200px"
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </Link>
              <p className="mt-2 truncate text-sm text-white/80">{listing.name}</p>
              {isOwner ? (
                <Link
                  href={`/members/${slug}?edit=listing&id=${listing.id}`}
                  className="mt-1 inline-flex text-[10px] uppercase tracking-[0.14em] text-electric hover:text-electric-hover"
                >
                  Edit
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyCopy>No stock listed yet.</EmptyCopy>
      )}
      {isOwner ? (
        <OwnerLink href={`/members/${slug}?edit=listing`}>
          Add listing
        </OwnerLink>
      ) : null}
    </ProfilePanel>
  );
}

function MessagesTab() {
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/conversations")
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setUnread(data.unreadCount ?? 0);
      })
      .catch(() => {
        /* ignore — inbox link still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ProfilePanel title="Messages">
      <p className="text-sm text-white/55">
        Open your inbox to continue conversations with buyers and providers.
      </p>
      {unread != null ? (
        <p className="mt-3 text-sm text-white/70">
          {unread === 0
            ? "No unread messages."
            : `${unread} unread message${unread === 1 ? "" : "s"}.`}
        </p>
      ) : null}
      <Link
        href="/messages"
        className="mt-5 inline-flex h-11 items-center rounded-lg bg-electric px-5 text-xs font-medium uppercase tracking-[0.12em] text-white hover:bg-electric-hover"
      >
        Open inbox
      </Link>
    </ProfilePanel>
  );
}

function SettingsTab() {
  return (
    <ProfilePanel title="Settings">
      <ul className="space-y-3 text-sm">
        <li>
          <Link
            href="/profile"
            className="text-electric hover:text-electric-hover"
          >
            Manage profile (deep edit)
          </Link>
          <p className="mt-1 text-xs text-white/40">
            Network, stock, and full account tools.
          </p>
        </li>
        <li>
          <Link
            href="/profile/settings"
            className="text-electric hover:text-electric-hover"
          >
            Account settings
          </Link>
          <p className="mt-1 text-xs text-white/40">
            Email, security, and sign-out.
          </p>
        </li>
      </ul>
    </ProfilePanel>
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
  className = "mt-4",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex text-xs uppercase tracking-[0.14em] text-electric hover:text-electric-hover ${className}`}
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

function StockThumbnails({ listings }: { listings: Listing[] }) {
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

function ReviewsCarousel({ reviews }: { reviews: Member["reviews"] }) {
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
