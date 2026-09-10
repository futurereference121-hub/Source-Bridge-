"use client";

import type { TrustPassportTier } from "@/lib/trust-passport/types";
import { shieldAriaLabel } from "@/lib/trust-passport/copy";

type TrustPassportShieldProps = {
  tier: TrustPassportTier;
  onOpen?: () => void;
  size?: "sm" | "md";
  className?: string;
};

const TIER_STROKE: Record<TrustPassportTier, string> = {
  BRONZE: "#b45309",
  SILVER: "#94a3b8",
  GOLD: "#d97706",
};

/**
 * Trust Passport shield — visually distinct from the identity verification tick.
 */
export function TrustPassportShield({
  tier,
  onOpen,
  size = "md",
  className = "",
}: TrustPassportShieldProps) {
  const dim = size === "sm" ? 22 : 28;
  const label = shieldAriaLabel(tier);
  const fillId = `tp-fill-${tier.toLowerCase()}`;

  const inner = (
    <svg
      width={dim}
      height={dim}
      viewBox="0 0 32 36"
      aria-hidden={onOpen ? true : undefined}
      role={onOpen ? undefined : "img"}
      aria-label={onOpen ? undefined : label}
      className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
    >
      <defs>
        {tier === "BRONZE" ? (
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f0c089" />
            <stop offset="55%" stopColor="#c4782a" />
            <stop offset="100%" stopColor="#8a4b16" />
          </linearGradient>
        ) : null}
        {tier === "SILVER" ? (
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="45%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor="#64748b" />
          </linearGradient>
        ) : null}
        {tier === "GOLD" ? (
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>
        ) : null}
      </defs>
      <path
        d="M16 1.5c3.2 2.4 6.8 3.6 10.5 3.6v11.2c0 7.4-4.6 13.4-10.5 16.2C10.1 29.7 5.5 23.7 5.5 16.3V5.1C9.2 5.1 12.8 3.9 16 1.5Z"
        fill={`url(#${fillId})`}
        stroke={TIER_STROKE[tier]}
        strokeWidth="1.25"
      />
      <path
        d="M16 8.2v14.2M11.2 13.4h9.6"
        stroke="rgba(2,11,28,0.35)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );

  if (!onOpen) {
    return (
      <span className={`inline-flex shrink-0 items-center ${className}`}>
        {inner}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      title={label}
      className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric ${className}`}
    >
      {inner}
    </button>
  );
}
