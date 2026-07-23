import Image from "next/image";
import Link from "next/link";
import type { Member, Product } from "@/lib/types";
import { availabilityLabel, formatPrice } from "@/data/products";
import { getMemberById } from "@/data/members";

type ProductCardProps = {
  product: Product;
  member?: Member;
  priority?: boolean;
};

export function ProductCard({
  product,
  member: memberProp,
  priority = false,
}: ProductCardProps) {
  const member = memberProp ?? getMemberById(product.memberId);

  return (
    <Link
      href={`/marketplace/${product.slug}`}
      className="group flex flex-col outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-stone">
        <Image
          src={product.images[0]}
          alt={product.name}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          priority={priority}
        />
      </div>
      <div className="flex flex-1 flex-col pt-4">
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted">
          {product.subcategory ?? product.category}
        </p>
        <h3 className="mt-1.5 font-display text-xl leading-snug text-ink sm:text-2xl">
          {product.name}
        </h3>

        <div className="mt-3 space-y-1.5 text-xs text-muted">
          {member ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-ink">{member.displayName}</span>
              {member.verified ? (
                <span
                  className="inline-flex items-center border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted"
                  title="Verified member — identity verification expanding soon"
                >
                  Verified
                </span>
              ) : null}
            </p>
          ) : null}
          <p>
            {product.country}
            <span className="mx-1.5 text-border">·</span>
            {product.shippingAvailable ? "Shipping available" : "Local pickup"}
          </p>
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <p className="text-sm font-medium text-ink">
            {formatPrice(product.price, product.currency)}
          </p>
          <p className="text-xs text-muted">{availabilityLabel(product.availability)}</p>
        </div>
      </div>
    </Link>
  );
}
