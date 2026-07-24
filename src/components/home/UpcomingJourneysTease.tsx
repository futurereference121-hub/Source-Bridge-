import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { JourneyGrid } from "@/components/trust/JourneyCard";
import { getLaunchMember } from "@/data/members";

export function UpcomingJourneysTease() {
  const member = getLaunchMember();

  return (
    <section className="bg-surface py-20 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow="Upcoming Journeys"
          title="Movement creates opportunity."
          description="Placeholder travel corridors from our first community member. Journey matching and traveller tools come later — the story starts here."
          className="mb-12 sm:mb-16"
        />
        <JourneyGrid journeys={member.upcomingJourneys} />
      </Container>
    </section>
  );
}
