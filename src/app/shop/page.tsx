import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ShopCatalogue } from "@/components/shop/ShopCatalogue";
import { products } from "@/data/products";

export const metadata: Metadata = {
  title: "Shop",
  description:
    "Browse the Source Bridge catalogue — clothing, jewellery, home & living, and collectibles from Thailand and Russia.",
};

type ShopPageProps = {
  searchParams: Promise<{ category?: string; subcategory?: string }>;
};

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const params = await searchParams;

  return (
    <div className="pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Container>
        <SectionHeading
          eyebrow="Shop"
          title="Curated products for modern retail."
          description="Filter by category and subcategory. Every piece is selected for craftsmanship, presentation, and commercial relevance."
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
