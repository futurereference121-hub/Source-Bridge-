import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  availabilityLabel,
  formatPrice,
  getListingBySlugAsync,
  getMemberForListingAsync,
  getRelatedListingsAsync,
} from "@/lib/listings-service";
import { ListingGallery } from "@/components/marketplace/ListingGallery";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { MemberCardCompact } from "@/components/members/MemberCard";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { ContactSellerButton } from "@/components/marketplace/ContactSellerButton";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getListingBySlugAsync(slug);
  if (!listing) return { title: "Listing" };
  return {
    title: listing.name,
    description: listing.description,
  };
}

export default async function ListingDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const listing = await getListingBySlugAsync(slug);
  if (!listing) notFound();

  const [member, related] = await Promise.all([
    getMemberForListingAsync(listing),
    getRelatedListingsAsync(listing, 4),
  ]);

  const shippedFrom =
    listing.shipFromCity && listing.shipFromCountry
      ? `${listing.shipFromCity}, ${listing.shipFromCountry}`
      : listing.currentLocation || listing.country || null;

  return (
    <div className="bg-app-navy pt-28 pb-20 text-white sm:pt-32 sm:pb-28">
      <Container>
        <nav className="mb-8 text-xs uppercase tracking-[0.14em] text-white/45">
          <Link href="/explore" className="hover:text-white">
            Explore
          </Link>
          <span className="mx-2">/</span>
          <span className="text-white/80">{listing.name}</span>
        </nav>

        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <ListingGallery images={listing.images} name={listing.name} />

          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-white/45">
              {listing.subcategory || listing.category}
            </p>
            <h1 className="mt-3 font-display text-4xl text-white sm:text-5xl">
              {listing.name}
            </h1>
            <p className="mt-4 text-xl font-medium text-white">
              {formatPrice(listing.price, listing.currency)}
            </p>
            <p className="mt-2 text-sm text-white/55">
              {availabilityLabel(listing.availability)}
            </p>
            {shippedFrom ? (
              <p className="mt-2 text-sm text-white/70">
                Shipped from {shippedFrom}
              </p>
            ) : null}
            <p className="mt-1 text-sm text-white/45">
              {listing.shippingAvailable
                ? "Shipping available"
                : "Local arrangement"}
            </p>

            <p className="mt-8 text-base leading-relaxed text-white/65">
              {listing.description}
            </p>

            {listing.specs ? (
              <div className="mt-10 border-t border-white/10 pt-8">
                <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                  Details
                </h2>
                <dl className="mt-4 space-y-3">
                  {Object.entries(listing.specs).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex justify-between gap-6 border-b border-white/10 pb-3 text-sm"
                    >
                      <dt className="text-white/45">{key}</dt>
                      <dd className="text-right text-white/85">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            <div className="mt-8 border-t border-white/10 pt-8">
              <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                Shipping
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-white/55">
                {listing.shippingNote ??
                  (listing.shippingAvailable
                    ? "Worldwide shipping available through this member. Lead times vary by destination and availability."
                    : "Shipping details arranged directly with the member.")}
              </p>
            </div>

            {member ? (
              <div className="mt-10">
                <h2 className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                  Shared by
                </h2>
                <MemberCardCompact member={member} />
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button href={`/members/${member.slug}`} variant="outline">
                    View profile
                  </Button>
                  {listing.isDbListing ? (
                    <ContactSellerButton
                      toUserId={member.id}
                      listingId={listing.id}
                      listingName={listing.name}
                    />
                  ) : null}
                </div>
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
