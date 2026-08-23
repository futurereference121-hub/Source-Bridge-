"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Admin-scoped error UI — never send operators to the marketing homepage.
 * Retry stays inside the admin shell.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin-error]", error?.digest || error?.message || error);
  }, [error]);

  return (
    <div
      className="rounded-xl border border-white/10 bg-white/[0.03] px-6 py-10 text-center"
      data-testid="admin-error"
    >
      <h1 className="text-xl font-semibold text-white">Admin page failed to load</h1>
      <p className="mx-auto mt-3 max-w-md text-sm text-white/55">
        Your session was not cleared. Retry this tab, or open another admin
        section without leaving Adminsource.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center rounded-lg bg-electric px-5 text-xs font-medium uppercase tracking-[0.12em] text-white hover:bg-electric-hover"
          data-testid="admin-error-retry"
        >
          Retry
        </button>
        <Link
          href="/admin/verifications"
          className="inline-flex h-11 items-center rounded-lg border border-white/20 px-5 text-xs uppercase tracking-[0.12em] text-white/80 hover:border-white/40"
        >
          Verification
        </Link>
        <Link
          href="/admin/payments"
          className="inline-flex h-11 items-center rounded-lg border border-white/20 px-5 text-xs uppercase tracking-[0.12em] text-white/80 hover:border-white/40"
        >
          Protected Payments
        </Link>
        <Link
          href="/admin/reviews"
          className="inline-flex h-11 items-center rounded-lg border border-white/20 px-5 text-xs uppercase tracking-[0.12em] text-white/80 hover:border-white/40"
        >
          Reviews & Disputes
        </Link>
      </div>
    </div>
  );
}
