import type { Member } from "@/lib/types";
import { Star } from "lucide-react";

type TrustStatsProps = {
  member: Member;
};

export function TrustStats({ member }: TrustStatsProps) {
  const stats = [
    {
      label: "Response rate",
      value: `${member.responseRate}%`,
      note: "Placeholder",
    },
    {
      label: "Completed requests",
      value: String(member.reviews.completedRequests),
      note: member.reviews.note,
    },
    {
      label: "Average rating",
      value: member.reviews.averageRating.toFixed(1),
      note: `${member.reviews.totalReviews} reviews (placeholder)`,
      icon: true,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="border border-border bg-surface px-5 py-5"
          title={stat.note}
        >
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
