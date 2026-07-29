"use client";

import { useState } from "react";

export default function DocFrame({ label, src }: { label: string; src: string }) {
  const [errored, setErrored] = useState(false);

  return (
    <figure className="rounded-xl border border-white/10 bg-white/5 p-3">
      {errored ? (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-red-500/10 text-sm text-red-300">
          <span>Could not load document. Verify private Blob storage is configured.</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="aspect-[4/3] w-full rounded-lg bg-black/20 object-contain"
          src={src}
          alt={label}
          onError={() => setErrored(true)}
        />
      )}
      <figcaption className="mt-2 text-sm text-white/60">{label}</figcaption>
    </figure>
  );
}
