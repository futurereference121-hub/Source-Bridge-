"use client";

import { useEffect, useState } from "react";

type Props = {
  /** Shown after this delay (ms) so fast loads never flash the spinner. */
  delayMs?: number;
  label?: string;
  className?: string;
};

/**
 * Branded Source Bridge loader — appears only after a short threshold so
 * sub-300ms loads feel instant (no skeleton flash).
 */
export function SourceBridgeLoader({
  delayMs = 280,
  label = "Loading…",
  className = "",
}: Props) {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true);
      return;
    }
    const t = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs]);

  if (!visible) {
    return (
      <div
        className={`min-h-[4rem] ${className}`}
        aria-busy="true"
        aria-label={label}
      />
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 py-8 ${className}`}
      aria-busy="true"
      aria-label={label}
    >
      <div
        className="relative h-10 w-10"
        role="presentation"
        aria-hidden
      >
        <div className="absolute inset-0 rounded-full border-2 border-electric/20" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-electric" />
        <div className="absolute inset-[30%] rounded-full bg-electric/90" />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
        {label}
      </p>
    </div>
  );
}
