import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { MissionStory } from "@/components/home/MissionStory";
import { MeetFirstMember } from "@/components/home/MeetFirstMember";
import { FeaturedCategories } from "@/components/home/FeaturedCategories";
import { HowPeopleHelp } from "@/components/home/HowPeopleHelp";
import { HowSourcingWorks } from "@/components/home/HowSourcingWorks";
import { UpcomingJourneysTease } from "@/components/home/UpcomingJourneysTease";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { Button } from "@/components/ui/Button";
import { getFeaturedListings } from "@/data/products";
import { getLaunchMember } from "@/data/members";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Home",
  description: siteConfig.description,
};

export default function HomePage() {
  const member = getLaunchMember();
  const featured = getFeaturedListings(4);

  return (
    <>
      <Hero />
      <MissionStory />
      <MeetFirstMember />

      <section className="bg-surface py-20 sm:py-28">
        <Container>
          <div className="mb-12 flex flex-col gap-6 sm:mb-16 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeading
              eyebrow="Available Finds"
              title="Featured listings from the community"
              description={`Recent discoveries shared by ${member.displayName} — each tied to a real person in Thailand or Russia.`}
            />
            <Button
              href="/marketplace"
              variant="outline"
              className="shrink-0 self-start sm:self-auto"
            >
              Explore Marketplace
            </Button>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((listing, index) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                member={member}
                priority={index < 2}
              />
            ))}
          </div>
        </Container>
      </section>

      <HowPeopleHelp />
      <UpcomingJourneysTease />
      <FeaturedCategories />
      <HowSourcingWorks />

      <section className="py-20 sm:py-28">
        <Container>
          <div className="flex flex-col items-start gap-6 border border-border bg-surface p-8 sm:flex-row sm:items-center sm:justify-between sm:p-12">
            <div className="max-w-xl">
              <h2 className="font-display text-3xl text-ink sm:text-4xl">
                Ready to connect through people?
              </h2>
              <p className="mt-3 text-muted">
                Explore Available Finds or request personal sourcing through
                specialists, travellers, and locals.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button href="/marketplace" size="lg">
                Explore Marketplace
              </Button>
              <Button href="/sourcing" variant="outline" size="lg">
                Request Product Sourcing
              </Button>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
