import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";

export function MissionStory() {
  return (
    <section className="bg-surface py-20 sm:py-28">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20 lg:items-end">
          <SectionHeading
            eyebrow="The Mission"
            title="People are the bridge. Location is the value."
            description="If you're somewhere — or going somewhere — you can help someone. Source Bridge is a people-powered platform for trusted local access."
          />
          <div className="space-y-6 text-base leading-relaxed text-muted sm:text-lg">
            <p>
              We are not a retailer warehouse. We are not a company inventory
              catalogue. Every finding belongs to a real person — specialists,
              locals, travellers, and expats who create value because of where
              they are.
            </p>
            <p>
              Thailand and Russia are our first community locations. The same
              member profile structure scales to thousands of people worldwide.
            </p>
            <Button href="/about" variant="outline" size="md">
              Our Philosophy
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}
