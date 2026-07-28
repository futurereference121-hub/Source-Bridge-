function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-white/10 ${className ?? ""}`}
      aria-hidden
    />
  );
}

export default function ExploreLoading() {
  return (
    <div className="bg-app-navy min-h-[100svh] pt-24 pb-24 sm:pt-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-4 text-center">
          <SkeletonBlock className="mx-auto h-10 w-4/5 max-w-xl" />
          <SkeletonBlock className="mx-auto h-4 w-3/5 max-w-md" />
        </div>
        <SkeletonBlock className="mx-auto mt-10 h-12 max-w-3xl" />
        <SkeletonBlock className="mx-auto mt-12 h-40 max-w-2xl" />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-56" />
          ))}
        </div>
      </div>
      <span className="sr-only">Loading Explore…</span>
    </div>
  );
}
