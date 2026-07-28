function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-white/10 ${className ?? ""}`}
      aria-hidden
    />
  );
}

export default function MessagesLoading() {
  return (
    <div className="min-h-[100svh] bg-app-navy pb-24 pt-28 text-white">
      <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-6">
        <SkeletonBlock className="h-8 w-40" />
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-16 w-full" />
        ))}
      </div>
      <span className="sr-only">Loading messages…</span>
    </div>
  );
}
