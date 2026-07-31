"use client";

import { useEffect, type ReactNode } from "react";

type EditorShellProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /**
   * When false (default), clicking the dimmed backdrop does not close the editor.
   * Product editing must stay open until intentional Close / Cancel / successful save.
   */
  closeOnBackdrop?: boolean;
  /** When false, Escape does not close. Default true. */
  closeOnEscape?: boolean;
};

export function EditorShell({
  title,
  onClose,
  children,
  wide,
  closeOnBackdrop = false,
  closeOnEscape = true,
}: EditorShellProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && closeOnEscape) onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, closeOnEscape]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3 sm:items-center sm:p-6"
      onClick={closeOnBackdrop ? onClose : undefined}
      role="presentation"
      data-editor-shell="true"
      data-close-on-backdrop={closeOnBackdrop ? "true" : "false"}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className={`panel-navy max-h-[92vh] w-full overflow-y-auto rounded-xl p-5 text-white shadow-xl sm:p-6 ${
          wide ? "max-w-2xl" : "max-w-lg"
        }`}
        data-editor-dialog="true"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="font-display text-2xl text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-xs uppercase tracking-[0.14em] text-white/45 hover:text-white"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export async function apiJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || "Something went wrong");
  return data;
}

export function jsonBody(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const editorInputClass =
  "input-navy h-11 w-full rounded-lg px-4 text-sm";

export function EditorField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-white/45">{label}</span>
      {children}
    </label>
  );
}

export function EditorSubmit({
  children,
  busy,
}: {
  children: ReactNode;
  busy?: boolean;
}) {
  return (
    <button
      disabled={busy}
      type="submit"
      className="inline-flex h-11 items-center justify-center rounded-lg bg-electric px-5 text-xs font-medium uppercase tracking-[0.12em] text-white transition-colors hover:bg-electric-hover disabled:opacity-50"
    >
      {busy ? "Saving…" : children}
    </button>
  );
}
