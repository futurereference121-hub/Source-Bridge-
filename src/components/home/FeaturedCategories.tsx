import { categories } from "@/data/categories";
import { CategoryCard } from "@/components/product/CategoryCard";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";

export function FeaturedCategories() {
  return (
    <section className="bg-surface py-20 sm:py-28">
      <Container>
        <div className="mb-12 flex flex-col gap-6 sm:mb-16 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            eyebrow="Catalogue"
            title="Featured Categories"
            description="Explore collections shaped by members — clothing, jewellery, home, and rare collectibles."
          />
          <Button href="/categories" variant="outline" className="shrink-0 self-start sm:self-auto">
            View All Categories
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {categories.map((category, index) => (
            <CategoryCard key={category.id} category={category} large={index === 0} />
          ))}
        </div>
      </Container>
    </section>
  );
}
