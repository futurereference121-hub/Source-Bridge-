import Link from "next/link";

/**
 * Homepage hero CTAs — Explore (left) + combined Sign Up/In (right).
 * Explore must not live in the homepage top-right header.
 */
export function HeroActions() {
  return (
    <div className="animate-fade-up animate-delay-2 relative z-10 mx-auto mt-9 flex w-full max-w-xl flex-col items-stretch justify-center gap-3 sm:mt-10 sm:flex-row sm:items-stretch sm:justify-center">
      <Link
        href="/explore"
        className="btn-glow-secondary inline-flex min-h-[56px] flex-1 items-center justify-center rounded-lg bg-white px-8 py-3.5 text-center text-sm font-bold uppercase tracking-[0.12em] text-navy transition-colors hover:bg-stone"
      >
        Explore
      </Link>
      <Link
        href="/join"
        className="btn-glow-primary inline-flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg bg-electric px-8 py-3.5 text-center text-white transition-colors hover:bg-electric-hover"
      >
        <span className="text-sm font-bold uppercase tracking-[0.12em]">
          Sign Up/In
        </span>
        <span className="text-[11px] font-medium tracking-[0.02em] text-white/90">
          Earn from your location.
        </span>
      </Link>
    </div>
  );
}
