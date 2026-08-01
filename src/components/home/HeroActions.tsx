import Link from "next/link";

export function HeroActions() {
  return (
    <div className="animate-fade-up animate-delay-2 relative z-10 mx-auto mt-9 flex w-full max-w-md flex-col items-center justify-center sm:mt-10">
      <Link
        href="/join"
        className="btn-glow-primary inline-flex min-h-[56px] w-full max-w-sm flex-col items-center justify-center gap-0.5 rounded-lg bg-electric px-8 py-3.5 text-center text-white transition-colors hover:bg-electric-hover"
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
