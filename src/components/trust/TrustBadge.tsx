import type { VerificationBadge } from "@/lib/types";
import {
  Award,
  BadgeCheck,
  Briefcase,
  Plane,
  Shield,
  Star,
} from "lucide-react";

const ICON_MAP = {
  verified_identity: BadgeCheck,
  trusted_member: Shield,
  specialist: Award,
  business_verified: Briefcase,
  traveller: Plane,
  top_rated: Star,
} as const;

type TrustBadgeProps = {
  badge: VerificationBadge;
  size?: "sm" | "md";
};

export function TrustBadge({ badge, size = "sm" }: TrustBadgeProps) {
  const Icon = ICON_MAP[badge.kind];
  const pad = size === "sm" ? "px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-xs";

  return (
    <span
      className={`inline-flex items-center gap-1.5 border border-border bg-surface ${pad} uppercase tracking-[0.12em] text-ink`}
      title={badge.placeholder ? "Placeholder — verification coming soon" : badge.label}
    >
      <Icon size={size === "sm" ? 12 : 14} strokeWidth={1.5} className="text-accent" />
      {badge.label}
    </span>
  );
}

type TrustBadgeRowProps = {
  badges: VerificationBadge[];
  size?: "sm" | "md";
};

export function TrustBadgeRow({ badges, size = "sm" }: TrustBadgeRowProps) {
  return (
    <ul className="flex flex-wrap gap-2">
      {badges.map((badge) => (
        <li key={badge.kind}>
          <TrustBadge badge={badge} size={size} />
        </li>
      ))}
    </ul>
  );
}
