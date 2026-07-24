import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  availabilityLabel,
  formatPrice,
  getListingBySlug,
  getRelatedListings,
  listings,
} from "@/data/products";
import { getMemberForListing } from "@/data/members";
import { ListingGallery } from "@/components/marketplace/ListingGallery";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { MemberCardCompact } from "@/components/members/MemberCard";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return listings.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const listing = getListingBySlug(slug);
  if (!listing) return { title: "Listing" };
  return {
    title: listing.name,
    description: listing.description,
  };
}

export default async function ListingDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const listing = getListingBySlug(slug);
  if (!listing) notFound();

  const member = getMemberForListing(listing);
  const related = getRelatedListings(listing, 4);

  return (
    <div className="pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Container>
        <nav className="mb-8 text-xs uppercase tracking-[0.14em] text-muted">
          <Link href="/explore" className="hover:text-ink">
            Explore
          </Link>
          <span className="mx-2">/</span>
          <span className="text-ink">{listing.name}</span>
        </nav>

        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <ListingGallery images={listing.images} name={listing.name} />

          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted">
              {listing.subcategory ?? listing.category}
            </p>
            <h1 className="mt-3 font-display text-4xl text-ink sm:text-5xl">
              {listing.name}
            </h1>
            <p className="mt-4 text-xl font-medium text-ink">
              {formatPrice(listing.price, listing.currency)}
            </p>
            <p className="mt-2 text-sm text-muted">
              {availabilityLabel(listing.availability)}
              <span className="mx-2 text-border">·</span>
              {listing.country}
              <span className="mx-2 text-border">·</span>
              {listing.currentLocation}
            </p>
            <p className="mt-1 text-sm text-muted">
              {listing.shippingAvailable
                ? "Shipping available"
                : "Local arrangement"}
            </p>

            <p className="mt-8 text-base leading-relaxed text-muted">
              {listing.description}
            </p>

            {listing.specs ? (
              <div className="mt-10 border-t border-border pt-8">
                <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
                  Details
                </h2>
                <dl className="mt-4 space-y-3">
                  {Object.entries(listing.specs).map(([key, value]) => (
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

            <div className="mt-8 border-t border-border pt-8">
              <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
                Shipping
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {listing.shippingNote ??
                  (listing.shippingAvailable
                    ? "Worldwide shipping available through this member. Lead times vary by destination and availability."
                    : "Shipping details arranged directly with the member.")}
              </p>
            </div>

            {member ? (
              <div className="mt-10">
                <h2 className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                  Shared by
                </h2>
                <MemberCardCompact member={member} />
                <Button href={`/members/${member.slug}`} className="mt-4" variant="outline">
                  View profile
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {related.length ? (
          <section className="mt-20">
            <SectionHeading
              eyebrow="More finds"
              title="Related listings"
              className="mb-10"
            />
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((item) => (
                <ListingCard key={item.id} listing={item} />
              ))}
            </div>
          </section>
        ) : null}
      </Container>
    </div>
  );
}
