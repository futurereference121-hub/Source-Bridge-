import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/lib/types";
import { availabilityLabel, formatPrice } from "@/data/products";

type ProductCardProps = {
  product: Product;
  priority?: boolean;
};

export function ProductCard({ product, priority = false }: ProductCardProps) {
  return (
    <Link
      href={`/shop/${product.slug}`}
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
