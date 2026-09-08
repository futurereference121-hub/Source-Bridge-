"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { usePwaInstall } from "@/hooks/usePwaInstall";

type GetTheAppButtonProps = {
  /** Visual placement — one canonical install flow for all surfaces. */
  variant?: "menu" | "desktop" | "account" | "hero" | "explore";
  className?: string;
  onAfterAction?: () => void;
};

export function GetTheAppButton({
  variant = "menu",
  className = "",
  onAfterAction,
}: GetTheAppButtonProps) {
  const { ready, isStandalone, mode, requestInstall } = usePwaInstall();
  const [guidance, setGuidance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Wait for client display-mode check so standalone never flashes CTAs.
  // Do NOT hide for missing beforeinstallprompt, auth, or loading.
  if (!ready || isStandalone || mode === "hidden") {
    return null;
  }

  const baseClass =
    variant === "menu"
      ? "flex w-full items-center gap-2 py-3 text-left text-sm font-medium uppercase tracking-[0.14em] text-white/80"
      : variant === "account"
        ? "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/75 transition-colors hover:bg-white/[0.06] hover:text-white"
        : variant === "hero"
          ? "inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-white/55 bg-white/5 px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white backdrop-blur-sm transition-colors hover:border-white/80 hover:bg-white/10 sm:w-auto sm:min-w-[12rem]"
          : variant === "explore"
            ? "inline-flex h-9 items-center gap-2 rounded-lg border border-white/25 bg-white/[0.04] px-3.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/85 transition-colors hover:border-electric/40 hover:text-white"
            : "inline-flex h-10 items-center gap-2 rounded-lg border border-white/40 px-3 text-xs font-medium uppercase tracking-[0.14em] text-white transition-colors hover:bg-white/10";

  async function onClick() {
    setBusy(true);
    setGuidance(null);
    try {
      const outcome = await requestInstall();
      if (outcome === "dismissed") {
        setGuidance("Install cancelled. You can try again anytime.");
      } else if (outcome === "unavailable") {
        setGuidance(
          "Install isn't available in this view. Open Source Bridge in Chrome, Edge, or Safari.",
        );
      }
      // Sheets are fixed overlays (PwaInstallHost) — safe to close menus after guided/native.
      if (outcome === "accepted" || outcome === "guided" || outcome === "dismissed") {
        onAfterAction?.();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={
        variant === "menu" || variant === "account"
          ? "w-full"
          : variant === "hero"
            ? "flex w-full justify-center"
            : ""
      }
    >
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={busy}
        className={`${baseClass} ${className}`}
        aria-label="Get the Source Bridge app"
        data-sb-get-the-app={variant}
      >
        <Download
          size={variant === "explore" ? 14 : 16}
          strokeWidth={1.75}
          aria-hidden
        />
        GET THE APP
      </button>
      {guidance ? (
        <p
          role="status"
          className={`mt-1 text-xs leading-relaxed text-white/55 ${
            variant === "desktop" || variant === "explore"
              ? "max-w-[16rem]"
              : variant === "hero"
                ? "mx-auto max-w-sm text-center"
                : "px-0"
          }`}
        >
          {guidance}
        </p>
      ) : null}
    </div>
  );
}
