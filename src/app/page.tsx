import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { MeetFirstMember } from "@/components/home/MeetFirstMember";
import { WhoWeAre } from "@/components/home/WhoWeAre";
import { FeaturedCategories } from "@/components/home/FeaturedCategories";
import { WhySourceBridge } from "@/components/home/WhySourceBridge";
import { HowSourcingWorks } from "@/components/home/HowSourcingWorks";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ProductCard } from "@/components/product/ProductCard";
import { Button } from "@/components/ui/Button";
import { getFeaturedProducts } from "@/data/products";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Home",
  description: siteConfig.description,
};

export default function HomePage() {
  const featured = getFeaturedProducts(4);

  return (
    <>
      <Hero />
      <MeetFirstMember />
      <WhoWeAre />
      <FeaturedCategories />

      <section className="bg-surface py-20 sm:py-28">
        <Container>
          <div className="mb-12 flex flex-col gap-6 sm:mb-16 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeading
              eyebrow="Marketplace"
              title="From our founding member"
              description="A living edit of listings shared from Thailand and Russia — each tied to a real member profile."
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
            {featured.map((product, index) => (
              <ProductCard key={product.id} product={product} priority={index < 2} />
            ))}
          </div>
        </Container>
      </section>

      <WhySourceBridge />
      <HowSourcingWorks />
    </>
  );
}
