import Image from "next/image";
import Link from "next/link";
import type { Category } from "@/lib/types";

type CategoryCardProps = {
  category: Category;
  large?: boolean;
};

export function CategoryCard({ category, large = false }: CategoryCardProps) {
  return (
    <Link
      href={`/explore?q=${encodeURIComponent(category.name)}`}
      className="group relative block overflow-hidden bg-stone outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className={`relative ${large ? "aspect-[4/5] sm:aspect-[16/10]" : "aspect-[4/5]"}`}>
        <Image
          src={category.image}
          alt={category.name}
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/70">
            Available finds
          </p>
          <h3 className="mt-2 font-display text-3xl text-white sm:text-4xl">
            {category.name}
          </h3>
          {large ? (
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/75">
              {category.description}
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
