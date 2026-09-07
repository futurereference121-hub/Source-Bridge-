"use client";

type Props = {
  count: number;
  available: boolean;
  /** Compact badge for top chrome next to LIVE timer. */
  className?: string;
};

/** Concurrent unique authenticated viewer count (Ably presence). No identity list. */
export function LiveViewerCount({ count, available, className }: Props) {
  if (!available) return null;
  return (
    <div
      className={
        className ||
        "inline-flex items-center gap-1.5 rounded-md bg-black/45 px-2 py-1 text-[11px] font-medium text-white/90 backdrop-blur-sm"
      }
      aria-label={`${count} watching`}
      title="Viewers watching now"
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
      <span>{count}</span>
      <span className="text-white/55">watching</span>
    </div>
  );
}
