import Image from "next/image";

/**
 * Cinematic Earth hero visual — photographic AI asset with soft CSS glow layers.
 * Optional SVG pulses only as overlay accents, never as the Earth itself.
 */
export function GlobalConnectionVisual({ className = "" }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 select-none overflow-hidden ${className}`}
      aria-hidden="true"
    >
      {/* Soft atmospheric glow behind / around the globe */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_62%_48%,rgba(59,130,246,0.22)_0%,rgba(4,26,54,0.25)_42%,transparent_70%)]" />

      <div className="globe-float absolute inset-0 flex items-center justify-center lg:justify-end">
        <div className="globe-drift relative h-[min(92vh,920px)] w-[min(140vw,1100px)] max-w-none translate-x-[8%] scale-[1.05] sm:translate-x-[4%] sm:scale-100 lg:translate-x-[6%] lg:scale-[1.08]">
          <Image
            src="/hero/earth-network.png"
            alt=""
            fill
            priority
            sizes="(max-width: 768px) 140vw, (max-width: 1280px) 90vw, 1100px"
            className="object-contain object-center drop-shadow-[0_0_60px_rgba(59,130,246,0.18)]"
          />

          {/* Subtle pulsing node overlays — accents only */}
          <div className="absolute inset-0">
            <span className="globe-node-pulse absolute left-[58%] top-[34%] h-2 w-2 rounded-full bg-[#93c5fd]/80 shadow-[0_0_12px_4px_rgba(59,130,246,0.55)]" />
            <span className="globe-node-pulse absolute left-[68%] top-[48%] h-2.5 w-2.5 rounded-full bg-white/90 shadow-[0_0_16px_5px_rgba(147,197,253,0.6)] [animation-delay:0.8s]" />
            <span className="globe-node-pulse absolute left-[52%] top-[56%] h-1.5 w-1.5 rounded-full bg-[#60a5fa]/90 shadow-[0_0_10px_3px_rgba(59,130,246,0.5)] [animation-delay:1.6s]" />
            <span className="globe-node-pulse absolute left-[74%] top-[38%] h-2 w-2 rounded-full bg-[#bfdbfe]/85 shadow-[0_0_14px_4px_rgba(96,165,250,0.55)] [animation-delay:2.2s]" />
          </div>
        </div>
      </div>

      {/* Soft navy fades so globe blends; text remains readable when centered */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#020b1c]/75 via-[#020b1c]/25 to-transparent sm:from-[#020b1c]/55 sm:via-[#020b1c]/15" />
      <div className="absolute inset-0 bg-gradient-to-l from-[#020b1c]/50 via-transparent to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#020b1c] to-transparent" />
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#020b1c]/80 to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,rgba(2,11,28,0.35)_0%,transparent_55%)] sm:bg-[radial-gradient(ellipse_at_50%_45%,rgba(2,11,28,0.2)_0%,transparent_58%)]" />
    </div>
  );
}
