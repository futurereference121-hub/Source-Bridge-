import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";

export function WhoWeAre() {
  return (
    <section className="bg-surface py-20 sm:py-28">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20 lg:items-end">
          <SectionHeading
            eyebrow="The Idea"
            title="People are the product. Location is the value."
            description="If you're somewhere — or going somewhere — you can help someone. Source Bridge is a people-powered marketplace for trusted local access."
          />
          <div className="space-y-6 text-base leading-relaxed text-muted sm:text-lg">
            <p>
              Every listing belongs to a member profile. Specialists, locals, and
              travellers share products and sourcing knowledge from where they are —
              not from a company warehouse.
            </p>
            <p>
              We start with our founding member across Thailand and Russia. The same
              structure will welcome future members worldwide.
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
