import type { Service } from "@/lib/types";

/** Lightweight helpers for service labels — extensible for future DB keys. */
export function serviceLabels(services: Service[]): string[] {
  return services.map((s) => s.label);
}
