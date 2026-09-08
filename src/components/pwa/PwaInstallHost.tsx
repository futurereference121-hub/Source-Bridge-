"use client";

/**
 * Single mount for install guidance sheets so multiple GET THE APP placements
 * share one dialog and do not stack duplicate overlays.
 */
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { IosInstallSheet } from "@/components/pwa/IosInstallSheet";
import { ManualInstallSheet } from "@/components/pwa/ManualInstallSheet";

export function PwaInstallHost() {
  const { iosSheetOpen, setIosSheetOpen, manualSheetOpen, setManualSheetOpen } =
    usePwaInstall();

  return (
    <>
      <IosInstallSheet open={iosSheetOpen} onClose={() => setIosSheetOpen(false)} />
      <ManualInstallSheet
        open={manualSheetOpen}
        onClose={() => setManualSheetOpen(false)}
      />
    </>
  );
}
