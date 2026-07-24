import { BadgeCheck } from "lucide-react";

type VerificationBadgeProps = {
  verified?: boolean;
  label?: string;
  size?: "sm" | "md";
};

export function VerificationBadge({
  verified = true,
  label = "Verified",
  size = "sm",
}: VerificationBadgeProps) {
  if (!verified) return null;

  const pad = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";

  return (
    <span
      className={`inline-flex items-center gap-1 border border-border bg-accent-soft ${pad} uppercase tracking-[0.12em] text-accent`}
      title="Identity verification — prototype"
    >
      <BadgeCheck size={size === "sm" ? 12 : 14} strokeWidth={1.5} />
      {label}
    </span>
  );
}
