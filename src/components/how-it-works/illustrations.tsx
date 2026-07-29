"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Plane } from "lucide-react";

/**
 * Minimal line-art illustration primitives for the How It Works story.
 * Original SVGs only — no external art assets. Kept intentionally simple
 * (thin rounded strokes, open shapes) to match the premium, non-childish
 * Source Bridge navy/electric visual language.
 */

const ELECTRIC = "#60a5fa";
const SOFT_WHITE = "rgba(255,255,255,0.82)";

type StickFigurePose = "stand" | "point" | "carry" | "wave" | "receive";
type StickFigureHair = "none" | "pony" | "short";

type StickFigureProps = {
  className?: string;
  color?: string;
  hair?: StickFigureHair;
  pose?: StickFigurePose;
  flip?: boolean;
  size?: number;
  bob?: boolean;
};

export function StickFigure({
  className = "",
  color = SOFT_WHITE,
  hair = "none",
  pose = "stand",
  flip = false,
  size = 72,
  bob = false,
}: StickFigureProps) {
  const arms = ARM_PATHS[pose];
  const legs = LEG_PATHS[pose];

  return (
    <div
      className={`inline-block leading-none ${className}`}
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <div className={bob ? "hiw-bob" : ""}>
        <svg viewBox="0 0 60 100" width={size} height={(size * 100) / 60} fill="none" aria-hidden="true">
          {hair === "pony" ? (
            <path
              d="M39 9c5 1 9 5 6 13-1.5 3.6-4 4.6-6 4.4"
              stroke={color}
              strokeWidth={3.5}
              strokeLinecap="round"
            />
          ) : null}
          {hair === "short" ? (
            <path d="M19 11c3-6 19-6 22 0" stroke={color} strokeWidth={3.5} strokeLinecap="round" />
          ) : null}
          <circle cx="30" cy="17" r="10.5" stroke={color} strokeWidth={3.5} />
          <path d="M30 27.5L30 62" stroke={color} strokeWidth={3.5} strokeLinecap="round" />
          <path d={arms} stroke={color} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d={legs} stroke={color} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

const ARM_PATHS: Record<StickFigurePose, string> = {
  stand: "M30 36L15 53M30 36L45 53",
  point: "M30 36L15 50M30 36L54 28",
  carry: "M30 36L18 47L15 61M30 36L45 53",
  wave: "M30 36L15 53M30 36L49 19",
  receive: "M30 36L15 53M30 36L48 40",
};

const LEG_PATHS: Record<StickFigurePose, string> = {
  stand: "M30 62L17 96M30 62L43 96",
  point: "M30 62L17 96M30 62L43 96",
  carry: "M30 62L18 96M30 62L41 94",
  wave: "M30 62L17 96M30 62L43 96",
  receive: "M30 62L19 95M30 62L42 96",
};

export function Suitcase({
  className = "",
  color = ELECTRIC,
  size = 30,
}: {
  className?: string;
  color?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 44 36"
      width={size}
      height={(size * 36) / 44}
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16 10V7a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3"
        stroke={color}
        strokeWidth={2.75}
        strokeLinecap="round"
      />
      <rect
        x="3"
        y="10"
        width="38"
        height="23"
        rx="4.5"
        stroke={color}
        strokeWidth={2.75}
        fill="rgba(96,165,250,0.08)"
      />
      <path d="M3 20h38" stroke={color} strokeWidth={1.5} opacity={0.45} />
      <path d="M19 10v23M25 10v23" stroke={color} strokeWidth={1.5} opacity={0.35} />
    </svg>
  );
}

export function LocationPin({
  className = "",
  color = ELECTRIC,
  label,
  pulse = true,
  size = 26,
}: {
  className?: string;
  color?: string;
  label?: string;
  pulse?: boolean;
  size?: number;
}) {
  return (
    <div className={`inline-flex flex-col items-center gap-1.5 ${className}`}>
      <div className="relative" style={{ width: size, height: (size * 32) / 24 }}>
        <svg viewBox="0 0 24 32" width={size} height={(size * 32) / 24} fill="none" aria-hidden="true">
          <path
            d="M12 1.5C6.2 1.5 1.5 6.1 1.5 11.8c0 8 10.5 18.7 10.5 18.7s10.5-10.7 10.5-18.7C22.5 6.1 17.8 1.5 12 1.5z"
            stroke={color}
            strokeWidth={2}
            fill="rgba(96,165,250,0.1)"
          />
        </svg>
        <span
          className={`absolute left-1/2 top-[34%] h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full ${
            pulse ? "hiw-pulse-dot" : ""
          }`}
          style={{ backgroundColor: color }}
        />
      </div>
      {label ? (
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">
          {label}
        </span>
      ) : null}
    </div>
  );
}

export function RouteArc({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();

  return (
    <div className={`relative ${className}`} aria-hidden="true">
      <svg viewBox="0 0 320 90" className="h-auto w-full overflow-visible" fill="none">
        <motion.path
          d="M8 78 Q160 -6 312 78"
          stroke="rgba(96,165,250,0.55)"
          strokeWidth={2}
          strokeDasharray="7 8"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: reduce ? 0.01 : 1.5, ease: "easeInOut" }}
        />
      </svg>
      <motion.div
        className="absolute text-electric drop-shadow-[0_0_6px_rgba(96,165,250,0.6)]"
        initial={{ left: "1%", top: "82%", opacity: 0, rotate: -6 }}
        whileInView={{
          left: ["1%", "47%", "93%"],
          top: ["82%", "6%", "82%"],
          opacity: 1,
          rotate: [-6, 4, -6],
        }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: reduce ? 0.01 : 1.7, ease: "easeInOut", delay: 0.15 }}
        style={{ transform: "translate(-50%, -50%)" }}
      >
        <Plane size={16} strokeWidth={2} />
      </motion.div>
    </div>
  );
}

export function CeramicCup({
  className = "",
  size = 40,
  color = ELECTRIC,
}: {
  className?: string;
  size?: number;
  color?: string;
}) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9.5 13h17l-1.5 15.2A3.8 3.8 0 0 1 21.2 32h-5.4a3.8 3.8 0 0 1-3.8-3.8L9.5 13z"
        stroke={color}
        strokeWidth={2.25}
        fill="rgba(96,165,250,0.14)"
        strokeLinejoin="round"
      />
      <path
        d="M26.5 15.3c3 .2 5.2 2.2 5 4.9-.2 2.7-2.6 4.6-5.5 4.4"
        stroke={color}
        strokeWidth={2.25}
        strokeLinecap="round"
      />
      <path d="M11.2 18.5h15.2" stroke={color} strokeWidth={1.5} opacity={0.55} />
      <path d="M11.8 22.6h14" stroke={color} strokeWidth={1.5} opacity={0.35} />
    </svg>
  );
}