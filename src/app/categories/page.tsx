import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { categories } from "@/data/categories";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

export const metadata: Metadata = {
  title: "Categories",
  description:
    "Browse Available Finds by category — Clothing, Jewellery, Home & Living, and Collectibles shared by members.",
};

export default function CategoriesPage() {
  return (
    <div className="pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Container>
        <SectionHeading
          eyebrow="Categories"
          title="Find your way through Available Finds."
          description="Browse by category and subcategory — the same structure used throughout the marketplace."
          className="mb-14 sm:mb-20"
        />

        <div className="space-y-16 sm:space-y-24">
          {categories.map((category) => (
            <section key={category.id} className="grid gap-8 lg:grid-cols-2 lg:gap-14">
              <Link
                href={`/marketplace?category=${encodeURIComponent(category.name)}`}
                className="group relative aspect-[4/5] overflow-hidden bg-stone sm:aspect-[16/11] lg:aspect-auto lg:min-h-[420px]"
              >
                <Image
                  src={category.image}
                  alt={category.name}
                  fill
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                />
              </Link>
              <div className="flex flex-col justify-center">
                <h2 className="font-display text-4xl text-ink sm:text-5xl">
                  {category.name}
                </h2>
                <p className="mt-4 max-w-lg text-base leading-relaxed text-muted">
                  {category.description}
                </p>
                <ul className="mt-8 grid gap-2 sm:grid-cols-2">
                  {category.subcategories.map((sub) => (
                    <li key={sub.id}>
                      <Link
                        href={`/marketplace?category=${encodeURIComponent(category.name)}&subcategory=${encodeURIComponent(sub.name)}`}
                        className="block border-b border-border py-3 text-sm text-ink transition-colors hover:text-accent"
                      >
                        {sub.name}
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/marketplace?category=${encodeURIComponent(category.name)}`}
                  className="mt-8 inline-flex text-xs font-medium uppercase tracking-[0.16em] text-accent hover:text-accent-hover"
                >
                  Browse {category.name} →
                </Link>
              </div>
            </section>
          ))}
        </div>
      </Container>
    </div>
  );
}
