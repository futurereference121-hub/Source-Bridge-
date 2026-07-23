import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ShopCatalogue } from "@/components/shop/ShopCatalogue";
import { products } from "@/data/products";

export const metadata: Metadata = {
  title: "Marketplace",
  description:
    "Discover products shared by Source Bridge members — local access, trusted listings, and shipping across borders.",
};

type MarketplacePageProps = {
  searchParams: Promise<{ category?: string; subcategory?: string }>;
};

export default async function MarketplacePage({ searchParams }: MarketplacePageProps) {
  const params = await searchParams;

  return (
    <div className="pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Container>
        <SectionHeading
          eyebrow="Marketplace"
          title="Discover what members share from where they are."
          description="Premium listings from the community. Every product belongs to a member profile — with country of origin and shipping clarity built in."
          className="mb-12 sm:mb-16"
        />
        <ShopCatalogue
          products={products}
          initialCategory={params.category ?? ""}
          initialSubcategory={params.subcategory ?? ""}
        />
      </Container>
    </div>
  );
}
