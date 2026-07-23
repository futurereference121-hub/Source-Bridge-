import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";

export function WhoWeAre() {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20 lg:items-end">
          <SectionHeading
            eyebrow="Who We Are"
            title="A bridge between makers, markets, and modern retail."
            description="Source Bridge connects international buyers with carefully vetted product networks across Thailand and Russia — scaling toward more regions as demand grows."
          />
          <div className="space-y-6 text-base leading-relaxed text-muted sm:text-lg">
            <p>
              We operate at the intersection of curated retail and professional sourcing.
              Whether you need ready-to-sell inventory or custom manufacturing, our team
              manages relationships, quality checks, and logistics with discretion.
            </p>
            <p>
              Our storefront showcases a living catalogue of apparel, jewellery, home
              goods, and collectibles — while our sourcing desk builds tailored supply
              programs for retailers and brands.
            </p>
            <Button href="/about" variant="outline" size="md">
              Learn About Us
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}
