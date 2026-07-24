import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { MarketplaceCatalogue } from "@/components/marketplace/MarketplaceCatalogue";
import { listings } from "@/data/products";

export const metadata: Metadata = {
  title: "Marketplace",
  description:
    "Discover Available Finds shared by Source Bridge members — local access, trusted listings, and shipping across borders.",
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
          eyebrow="Available Finds"
          title="Discover what members share from where they are."
          description="Every listing belongs to a person. See who is offering it, where they are, and whether shipping is available."
          className="mb-12 sm:mb-16"
        />
        <MarketplaceCatalogue
          listings={listings}
          initialCategory={params.category ?? ""}
          initialSubcategory={params.subcategory ?? ""}
        />
      </Container>
    </div>
  );
}
