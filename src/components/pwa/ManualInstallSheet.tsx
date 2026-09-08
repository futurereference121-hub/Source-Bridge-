"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { SourceBridgeLogo } from "@/components/brand/SourceBridgeLogo";

type ManualInstallSheetProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * Accurate install guidance when the browser has not exposed a native
 * beforeinstallprompt event (Chrome/Edge still installable via browser UI).
 */
export function ManualInstallSheet({ open, onClose }: ManualInstallSheetProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab") return;
      const root = document.getElementById("sb-manual-install-sheet");
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Dismiss"
        onClick={onClose}
      />
      <div
        id="sb-manual-install-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[1] w-full max-w-md rounded-t-2xl border border-white/12 bg-[#020B1C] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 text-white shadow-2xl sm:rounded-2xl sm:px-6 sm:pb-6"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <SourceBridgeLogo size={36} color="white" />
            <div>
              <h2 id={titleId} className="text-base font-semibold tracking-wide">
                Install Source Bridge
              </h2>
              <p className="mt-0.5 text-xs text-white/55">
                Add this site from your browser menu — no app store needed.
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>

        <ol className="space-y-3 text-sm text-white/85">
          <li className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-electric/20 text-electric">
              1
            </span>
            <p className="pt-1">
              Open the browser menu (
              <span className="font-medium text-white">⋮</span> in Chrome / Edge).
            </p>
          </li>
          <li className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-electric/20 text-electric">
              2
            </span>
            <p className="pt-1">
              Tap{" "}
              <span className="font-medium text-white">Install app</span> or{" "}
              <span className="font-medium text-white">Add to Home screen</span>.
            </p>
          </li>
          <li className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-electric/20 text-electric">
              3
            </span>
            <p className="pt-1">Confirm to finish. Source Bridge opens full-screen next time.</p>
          </li>
        </ol>

        <p className="mt-4 text-xs leading-relaxed text-white/45">
          On iPhone, open this site in Safari and use Share → Add to Home Screen.
          If you already installed Source Bridge, open it from your home screen.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-lg border border-white/20 text-sm font-medium uppercase tracking-[0.12em] text-white hover:bg-white/10"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
