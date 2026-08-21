"use client";

import { useMemo, useState } from "react";

/** Pull http(s) image URLs from dispute details / evidence notes. */
export function extractEvidenceUrls(details?: string | null): string[] {
  if (!details) return [];
  const matches = details.match(/https?:\/\/[^\s)\]>"']+/gi) || [];
  const urls = matches.filter((u) =>
    /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(u) ||
    /blob\.vercel-storage|utfs\.io|imgur|cloudinary|images\./i.test(u),
  );
  return [...new Set(urls)].slice(0, 6);
}

export default function AdminEvidenceGallery({
  details,
}: {
  details?: string | null;
}) {
  const urls = useMemo(() => extractEvidenceUrls(details), [details]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  if (!urls.length) return null;

  return (
    <div className="mt-3 space-y-2" data-testid="admin-evidence-gallery">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
        Photo evidence
      </p>
      <div className="flex flex-wrap gap-2">
        {urls.map((url) => (
          <button
            key={url}
            type="button"
            onClick={() => setLightbox(url)}
            className="group relative h-16 w-16 overflow-hidden rounded-md border border-white/15 bg-black/30"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt="Evidence thumbnail"
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-[9px] text-white opacity-0 group-hover:opacity-100">
              View
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="text-[11px] text-electric hover:underline"
        onClick={() => setLightbox(urls[0])}
      >
        View Photo
      </button>
      {lightbox ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal
          data-testid="admin-evidence-lightbox"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Evidence full size"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}
