import Image from "next/image";
import type { Member } from "@/lib/types";
import { TrustBadgeRow } from "@/components/trust/TrustBadge";
import { BridgeScoreCard } from "@/components/trust/BridgeScoreCard";
import { TrustStats } from "@/components/trust/TrustStats";
import { JourneyGrid } from "@/components/trust/JourneyCard";
import { MemberServicesGrid } from "@/components/profile/MemberServicesGrid";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { getListingsByMember } from "@/data/products";
import { Container } from "@/components/ui/Container";

type MemberStorefrontProps = {
  member: Member;
};

/**
 * Full personal storefront — modular layout reused for every future member.
 */
export function MemberStorefront({ member }: MemberStorefrontProps) {
  const listings = getListingsByMember(member.id);

  return (
    <div>
      <div className="relative h-56 w-full bg-stone sm:h-72 md:h-80">
        <Image
          src={member.cover}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
      </div>

      <Container className="relative -mt-16 pb-20 sm:-mt-20 sm:pb-28">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
            <div className="relative h-28 w-28 overflow-hidden border-4 border-background bg-stone sm:h-36 sm:w-36">
              <Image
                src={member.photo}
                alt={member.displayName}
                fill
                sizes="144px"
                className="object-cover"
                priority
              />
            </div>
            <div>
              <h1 className="font-display text-4xl text-ink sm:text-5xl">
                {member.displayName}
              </h1>
              <p className="mt-2 text-sm text-muted">
                {member.currentLocation}
                <span className="mx-2 text-border">·</span>
                Speaks {member.languages.join(", ")}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted">
                {member.availability}
              </p>
            </div>
          </div>
          <Button variant="outline" size="lg" disabled type="button">
            Contact Member — Coming Soon
          </Button>
        </div>

        <p className="mt-8 max-w-3xl text-base leading-relaxed text-muted sm:text-lg">
          {member.bio}
        </p>

        <div className="mt-8">
          <TrustBadgeRow badges={member.badges} size="md" />
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[280px_1fr] lg:gap-10">
          <BridgeScoreCard bridgeScore={member.bridgeScore} />
          <TrustStats member={member} />
        </div>

        <section className="mt-16 sm:mt-20">
          <SectionHeading
            eyebrow="Presence"
            title="Where this member connects"
            description="Countries of presence, travel readiness, and languages — the geography that creates value."
            className="mb-8"
          />
          <div className="grid gap-6 sm:grid-cols-3">
            <InfoBlock label="Countries" value={member.countries.join(" · ")} />
            <InfoBlock
              label="Willing to travel"
              value={member.areasWillingToTravel.join(" · ")}
            />
            <InfoBlock label="Languages" value={member.languages.join(" · ")} />
          </div>
        </section>

        <section className="mt-16 sm:mt-20">
          <SectionHeading
            eyebrow="How they can help"
            title="Services this member offers"
            description="Clear answers to: how can this person help me?"
            className="mb-10"
          />
          <MemberServicesGrid member={member} />
        </section>

        <section className="mt-16 sm:mt-20">
          <SectionHeading
            eyebrow="Travel"
            title="Upcoming journeys"
            description="Placeholder travel calendar — journey matching coming soon."
            className="mb-10"
          />
          <JourneyGrid journeys={member.upcomingJourneys} />
        </section>

        {listings.length > 0 ? (
          <section className="mt-16 sm:mt-20">
            <SectionHeading
              eyebrow="Available Finds"
              title={`Shared by ${member.displayName}`}
              description="Listings from this member’s local access — not company inventory."
              className="mb-10"
            />
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {listings.map((listing, index) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  member={member}
                  priority={index < 4}
                />
              ))}
            </div>
          </section>
        ) : null}

        <p className="mt-16 text-center text-sm text-muted">
          Reviews & messaging —{" "}
          <span className="italic">coming soon</span>
        </p>
      </Container>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-border pt-5">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink">{value}</p>
    </div>
  );
}
