import { BadgeCheck } from "lucide-react";

type VerificationBadgeProps = {
  verified?: boolean;
  label?: string;
  size?: "sm" | "md";
  variant?: "light" | "dark";
};

export function VerificationBadge({
  verified = true,
  label = "Verified",
  size = "sm",
  variant = "light",
}: VerificationBadgeProps) {
  if (!verified) return null;

  const pad = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";
  const tone =
    variant === "dark"
      ? "border-electric/35 bg-electric/15 text-electric"
      : "border-border bg-accent-soft text-accent";

  return (
    <span
      className={`inline-flex items-center gap-1 border ${tone} ${pad} uppercase tracking-[0.12em]`}
      title="Identity verification — prototype"
    >
      <BadgeCheck size={size === "sm" ? 12 : 14} strokeWidth={1.5} />
      {label}
    </span>
  );
}
