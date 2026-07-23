import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  availabilityLabel,
  formatPrice,
  getProductBySlug,
  getRelatedProducts,
  products,
} from "@/data/products";
import { ProductGallery } from "@/components/product/ProductGallery";
import { ProductCard } from "@/components/product/ProductCard";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) return { title: "Product" };
  return {
    title: product.name,
    description: product.description,
  };
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) notFound();

  const related = getRelatedProducts(product, 4);

  return (
    <div className="pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Container>
        <nav className="mb-8 text-xs uppercase tracking-[0.14em] text-muted">
          <Link href="/shop" className="hover:text-ink">
            Shop
          </Link>
          <span className="mx-2">/</span>
          <Link
            href={`/shop?category=${encodeURIComponent(product.category)}`}
            className="hover:text-ink"
          >
            {product.category}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-ink">{product.name}</span>
        </nav>

        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <ProductGallery images={product.images} name={product.name} />

          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted">
              {product.subcategory ?? product.category}
            </p>
            <h1 className="mt-3 font-display text-4xl text-ink sm:text-5xl">
              {product.name}
            </h1>
            <p className="mt-4 text-xl font-medium text-ink">
              {formatPrice(product.price, product.currency)}
            </p>
            <p className="mt-2 text-sm text-muted">
              {availabilityLabel(product.availability)}
            </p>

            <p className="mt-8 text-base leading-relaxed text-muted">
              {product.description}
            </p>

            {product.specs ? (
              <div className="mt-10 border-t border-border pt-8">
                <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
                  Specifications
                </h2>
                <dl className="mt-4 space-y-3">
                  {Object.entries(product.specs).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex justify-between gap-6 border-b border-border/70 pb-3 text-sm"
                    >
                      <dt className="text-muted">{key}</dt>
                      <dd className="text-right text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            {product.shippingNote ? (
              <div className="mt-8 border-t border-border pt-8">
                <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
                  Shipping
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  {product.shippingNote}
                </p>
              </div>
            ) : (
              <div className="mt-8 border-t border-border pt-8">
                <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
                  Shipping
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  Worldwide shipping available. Lead times vary by destination and
                  availability.
                </p>
              </div>
            )}

            {product.tags.length > 0 ? (
              <div className="mt-8 flex flex-wrap gap-2">
                {product.tags.map((tag) => (
                  <span
                    key={tag}
                    className="border border-border px-3 py-1 text-xs uppercase tracking-[0.12em] text-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Button href="/sourcing" size="lg">
                Request Similar Sourcing
              </Button>
              <Button href="/contact" variant="outline" size="lg">
                Ask About This Product
              </Button>
            </div>
          </div>
        </div>

        {related.length > 0 ? (
          <section className="mt-20 sm:mt-28">
            <SectionHeading
              title="Related products"
              description="More from the same collection."
              className="mb-10"
            />
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((item) => (
                <ProductCard key={item.id} product={item} />
              ))}
            </div>
          </section>
        ) : null}
      </Container>
    </div>
  );
}
