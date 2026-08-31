"use client";

type Props = {
  remainingMs: number;
  live?: boolean;
};

export function LiveTimer({ remainingMs, live = true }: Props) {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-sm tabular-nums text-white">
      {live ? (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
      ) : null}
      {m}:{s.toString().padStart(2, "0")}
    </span>
  );
}

export function LiveBadge({ label = "LIVE" }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white">
      {label}
    </span>
  );
}
