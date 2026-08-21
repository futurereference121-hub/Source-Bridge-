"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Accordion case row — collapsed by default; expand stays on the list page
 * (no navigation). Records expand latency for admin QA timing.
 */
export default function AdminCaseAccordion({
  id,
  summary,
  children,
  defaultOpen = false,
}: {
  id: string;
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const openedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!open || openedAt.current == null) return;
    const ms = Math.round(performance.now() - openedAt.current);
    if (typeof window !== "undefined") {
      (window as Window & { __SB_ADMIN_CASE_EXPAND_MS__?: number }).__SB_ADMIN_CASE_EXPAND_MS__ =
        ms;
    }
  }, [open]);

  return (
    <div
      className="rounded-xl border border-amber-400/20 bg-amber-400/5"
      data-testid="admin-case-accordion"
      data-case-id={id}
      data-open={open ? "1" : "0"}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer list-none px-5 py-4 text-left"
        aria-expanded={open}
        onClick={() => {
          if (!open) openedAt.current = performance.now();
          setOpen((v) => !v);
        }}
      >
        {summary}
      </button>
      {open ? (
        <div className="border-t border-amber-400/15 px-5 pb-5 pt-4">{children}</div>
      ) : null}
    </div>
  );
}
