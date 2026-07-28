function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-white/10 ${className ?? ""}`}
      aria-hidden
    />
  );
}

export default function MemberProfileLoading() {
  return (
    <div className="min-h-[100svh] bg-app-navy pt-16 pb-28 text-white sm:pt-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SkeletonBlock className="h-40 w-full rounded-xl sm:h-52" />
        <div className="mt-6 flex items-start gap-4">
          <SkeletonBlock className="h-20 w-20 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-3">
            <SkeletonBlock className="h-8 w-48" />
            <SkeletonBlock className="h-4 w-32" />
            <SkeletonBlock className="h-4 w-64 max-w-full" />
          </div>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <SkeletonBlock className="h-28" />
          <SkeletonBlock className="h-28" />
          <SkeletonBlock className="h-28" />
        </div>
      </div>
      <span className="sr-only">Loading profile…</span>
    </div>
  );
}
