import { BadgeCheck } from "lucide-react";

type VerificationBadgeProps = {
  verified?: boolean;
  label?: string;
  size?: "sm" | "md";
  /** "pill" shows gold floating badge with label; "tick" is icon-only for compact spaces */
  variant?: "pill" | "tick" | "light" | "dark";
};

/**
 * Premium gold verified badge.
 * Only render when the account is genuinely identity-verified.
 */
export function VerificationBadge({
  verified = true,
  label = "Verified",
  size = "sm",
  variant = "pill",
}: VerificationBadgeProps) {
  if (!verified) return null;

  // Compact gold tick for nav / inline username
  if (variant === "tick") {
    const dim = size === "sm" ? 14 : 16;
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center"
        title="Identity verified"
        aria-label="Verified"
      >
        <BadgeCheck
          size={dim}
          strokeWidth={2}
          className="text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.55)]"
          fill="rgba(251,191,36,0.18)"
        />
      </span>
    );
  }

  const pad = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-400/45 bg-gradient-to-b from-amber-300/20 to-amber-500/10 ${pad} font-semibold uppercase tracking-[0.12em] text-amber-200 shadow-[0_0_12px_-2px_rgba(251,191,36,0.45),0_1px_0_rgba(255,255,255,0.08)_inset]`}
      title="Identity verified"
    >
      <BadgeCheck
        size={size === "sm" ? 12 : 14}
        strokeWidth={2}
        className="text-amber-300"
        fill="rgba(251,191,36,0.25)"
      />
      {label}
    </span>
  );
}
