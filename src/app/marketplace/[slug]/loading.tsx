function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-white/10 ${className ?? ""}`}
      aria-hidden
    />
  );
}

export default function MarketplaceListingLoading() {
  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 sm:pt-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SkeletonBlock className="mb-8 h-3 w-40" />
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <SkeletonBlock className="aspect-square w-full rounded-xl" />
          <div className="space-y-4">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-12 w-4/5" />
            <SkeletonBlock className="h-6 w-28" />
            <SkeletonBlock className="mt-6 h-24 w-full" />
            <SkeletonBlock className="mt-8 h-20 w-full" />
          </div>
        </div>
      </div>
      <span className="sr-only">Loading listing…</span>
    </div>
  );
}
