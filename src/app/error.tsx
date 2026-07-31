"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/Container";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error?.digest || error?.message || error);
  }, [error]);

  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
      <Container className="max-w-lg text-center">
        <h1 className="font-display text-3xl text-white">Something went wrong</h1>
        <p className="mt-3 text-sm text-white/60">
          This page could not be loaded. Your data was not erased — try again or
          go back.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-11 items-center rounded-lg bg-electric px-5 text-xs font-medium uppercase tracking-[0.12em] text-white hover:bg-electric-hover"
          >
            Retry
          </button>
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-lg border border-white/20 px-5 text-xs uppercase tracking-[0.12em] text-white/80 hover:border-white/40"
          >
            Back home
          </Link>
        </div>
      </Container>
    </div>
  );
}
