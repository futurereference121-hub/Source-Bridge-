import type { Availability } from "@/lib/types";

const STYLES: Record<Availability, string> = {
  available_now: "bg-success/10 text-success border-success/25",
  limited: "bg-stone text-muted border-border",
  travelling_soon: "bg-accent-soft text-accent border-accent/20",
  unavailable: "bg-stone text-muted-light border-border",
};

type AvailabilityBadgeProps = {
  status: Availability;
  label: string;
};

export function AvailabilityBadge({ status, label }: AvailabilityBadgeProps) {
  return (
    <span
      className={`inline-flex border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] backdrop-blur-sm ${STYLES[status]}`}
    >
      {label}
    </span>
  );
}
