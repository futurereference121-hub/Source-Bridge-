"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { IosInstallSheet } from "@/components/pwa/IosInstallSheet";

type GetTheAppButtonProps = {
  /** Visual placement in existing chrome — no separate Android/Apple buttons. */
  variant?: "menu" | "desktop" | "account";
  className?: string;
  onAfterAction?: () => void;
};

export function GetTheAppButton({
  variant = "menu",
  className = "",
  onAfterAction,
}: GetTheAppButtonProps) {
  const {
    isStandalone,
    mode,
    iosSheetOpen,
    setIosSheetOpen,
    requestInstall,
  } = usePwaInstall();
  const [guidance, setGuidance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isStandalone || mode === "hidden") {
    return null;
  }

  const baseClass =
    variant === "menu"
      ? "flex w-full items-center gap-2 py-3 text-left text-sm font-medium uppercase tracking-[0.14em] text-white/80"
      : variant === "account"
        ? "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/75 transition-colors hover:bg-white/[0.06] hover:text-white"
        : "inline-flex h-10 items-center gap-2 rounded-lg border border-white/40 px-3 text-xs font-medium uppercase tracking-[0.14em] text-white transition-colors hover:bg-white/10";

  async function onClick() {
    setBusy(true);
    setGuidance(null);
    try {
      const outcome = await requestInstall();
      if (outcome === "unavailable") {
        setGuidance(
          "Open this site in Chrome or Edge on Android/desktop, or Safari on iPhone, then tap GET THE APP again.",
        );
      } else if (outcome === "dismissed") {
        setGuidance("Install cancelled. You can try again anytime from this menu.");
      } else if (outcome === "accepted") {
        setGuidance(null);
      }
      onAfterAction?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={variant === "menu" || variant === "account" ? "w-full" : ""}>
        <button
          type="button"
          onClick={() => void onClick()}
          disabled={busy}
          className={`${baseClass} ${className}`}
          aria-label="Get the Source Bridge app"
        >
          <Download size={16} strokeWidth={1.75} aria-hidden />
          Get the App
        </button>
        {guidance ? (
          <p
            role="status"
            className={`mt-1 text-xs leading-relaxed text-white/55 ${
              variant === "desktop" ? "max-w-[16rem]" : "px-0"
            }`}
          >
            {guidance}
          </p>
        ) : null}
      </div>
      <IosInstallSheet open={iosSheetOpen} onClose={() => setIosSheetOpen(false)} />
    </>
  );
}