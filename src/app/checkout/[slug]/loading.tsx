function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-white/10 ${className ?? ""}`}
      aria-hidden
    />
  );
}

export default function CheckoutLoading() {
  return (
    <div className="min-h-[100svh] bg-app-navy pt-28 pb-20 text-white sm:pt-32">
      <div className="mx-auto max-w-lg space-y-4 px-4 sm:px-6">
        <SkeletonBlock className="h-8 w-48" />
        <SkeletonBlock className="h-40 w-full" />
        <SkeletonBlock className="h-12 w-full" />
        <SkeletonBlock className="h-12 w-full" />
      </div>
      <span className="sr-only">Loading checkout…</span>
    </div>
  );
}
