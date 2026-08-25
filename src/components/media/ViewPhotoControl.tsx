"use client";

import { useState } from "react";

/** Thumbnail + VIEW PHOTO lightbox (admin, buyer, seller proof viewers). */
export function ViewPhotoControl({
  url,
  alt = "Photo evidence",
  testId = "view-photo-control",
  caption,
}: {
  url: string;
  alt?: string;
  testId?: string;
  caption?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!url) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3" data-testid={testId}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        className="h-14 w-14 cursor-pointer rounded-md border border-white/15 object-cover"
        onClick={() => setOpen(true)}
      />
      <div className="space-y-0.5">
        {caption ? (
          <p className="text-[11px] text-white/45">{caption}</p>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[11px] font-semibold uppercase tracking-[0.12em] text-electric hover:underline"
        >
          VIEW PHOTO
        </button>
      </div>
      {open ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          data-testid={`${testId}-lightbox`}
          onClick={() => setOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`${alt} full size`}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="absolute right-4 top-4 rounded-lg border border-white/20 bg-black/50 px-3 py-1.5 text-xs text-white"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
