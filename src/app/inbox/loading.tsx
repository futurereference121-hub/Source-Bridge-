export default function InboxLoading() {
  return (
    <div className="min-h-[100svh] bg-app-navy pb-20 pt-28 text-white">
      <div className="mx-auto max-w-6xl px-4">
        <div className="h-8 w-40 animate-pulse rounded bg-white/10" />
        <div className="panel-navy mt-8 flex min-h-[min(70vh,720px)] items-center justify-center rounded-xl">
          <p className="text-sm text-white/45">Loading inbox…</p>
        </div>
      </div>
    </div>
  );
}
