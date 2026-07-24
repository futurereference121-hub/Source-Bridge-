import { members } from "@/data/members";
import { JourneyGrid } from "@/components/trust/JourneyCard";
import { Container } from "@/components/ui/Container";

/** Legacy home tease — unused on the short homepage. */
export function UpcomingJourneysTease() {
  const journeys = members.flatMap((m) => m.journeys).slice(0, 4);
  return (
    <section className="py-16">
      <Container>
        <JourneyGrid journeys={journeys} />
      </Container>
    </section>
  );
}
