import type { Member } from "@/lib/types";
import { Star } from "lucide-react";

type TrustStatsProps = {
  member: Member;
};

export function TrustStats({ member }: TrustStatsProps) {
  const stats = [
    {
      label: "Completed requests",
      value: String(member.completedRequests),
    },
    {
      label: "Average rating",
      value: member.rating.toFixed(1),
      icon: true,
    },
    {
      label: "Bridge Score",
      value: String(member.bridgeScore),
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="border border-border bg-surface px-5 py-5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-muted">
            {stat.label}
          </p>
          <p className="mt-2 flex items-center gap-1.5 font-display text-3xl text-ink">
            {stat.icon ? (
              <Star size={18} strokeWidth={1.5} className="text-accent" />
            ) : null}
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}
