"use client";

import Image from "next/image";
import { useState } from "react";

type ListingGalleryProps = {
  images: string[];
  name: string;
};

export function ListingGallery({ images, name }: ListingGalleryProps) {
  const [active, setActive] = useState(0);
  const gallery = images.length ? images.slice(0, 6) : images;
  const current = gallery[active] ?? gallery[0];

  if (!current) {
    return (
      <div className="aspect-square overflow-hidden rounded-xl border border-white/10 bg-navy-mid" />
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-navy-mid">
        <Image
          src={current}
          alt={name}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover"
        />
      </div>
      {gallery.length > 1 ? (
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
          {gallery.map((src, index) => (
            <button
              key={src + index}
              type="button"
              onClick={() => setActive(index)}
              className={`relative aspect-square overflow-hidden rounded-lg bg-navy-mid outline-none transition ${
                active === index
                  ? "ring-2 ring-electric ring-offset-2 ring-offset-app-navy"
                  : "opacity-70 hover:opacity-100"
              }`}
              aria-label={`View image ${index + 1}${index === 0 ? " (cover)" : ""}`}
            >
              <Image src={src} alt="" fill sizes="96px" className="object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
