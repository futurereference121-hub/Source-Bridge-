"use client";

import { useEffect } from "react";
import { inspectionReloadDelayMs } from "@/lib/payments/fulfilment-display";

/** Reload from server state when the recorded 12-hour inspection deadline elapses. */
export function useInspectionDeadlineRefresh(
  endsAt: string | Date | null | undefined,
  reload: () => void,
) {
  useEffect(() => {
    const delay = inspectionReloadDelayMs(endsAt);
    if (delay == null) return;
    const timer = window.setTimeout(() => {
      reload();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [endsAt, reload]);
}
