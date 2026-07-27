import Image from "next/image";

/**
 * Lit Earth disk centre in earth-network.png, measured from the left edge of the
 * asset (right-weighted composition with an empty navy void on the left).
 */
const EARTH_CENTER_X = 63;

/**
 * Image plane size as a percentage of the viewport. The focal translate below
 * leaves only `100 - EARTH_CENTER_X`% of the plane to the right of the viewport
 * centre, so the plane needs to be at least 50 / 0.37 ≈ 136% wide to still reach
 * the right edge. 140 keeps a margin at every breakpoint.
 */
const PLANE_SCALE = 140;

/** earth-network.png is 1536x1024 (3:2). */
const ASSET_W = 1536;
const ASSET_H = 1024;

/**
 * Full-viewport Earth hero background.
 * Absolute inset-0 full-bleed cover — the Earth's centre is pinned to the
 * viewport centre so the globe sits directly behind the centred copy, with no
 * left dark panel and no vertical colour split.
 */
export function GlobalConnectionVisual({ className = "" }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-0 select-none overflow-hidden bg-[#020b1c] ${className}`}
      aria-hidden="true"
    >
      <div className="globe-float absolute inset-0">
        {/*
          Oversized 3:2 plane + focal translate pins the Earth to the viewport
          centre while covering every breakpoint. The positioning transform stays
          on this layer so the inner globe-drift animation cannot override it.
        */}
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            width: `max(${PLANE_SCALE}vw, calc(${PLANE_SCALE}vh * ${ASSET_W} / ${ASSET_H}))`,
            height: `max(${PLANE_SCALE}vh, calc(${PLANE_SCALE}vw * ${ASSET_H} / ${ASSET_W}))`,
            transform: `translate(-${EARTH_CENTER_X}%, -50%)`,
          }}
        >
          <div className="globe-drift absolute inset-0">
            <Image
              src="/hero/earth-network.png"
              alt=""
              fill
              priority
              sizes={`${PLANE_SCALE}vw`}
              className="object-cover object-center [filter:saturate(1.08)_hue-rotate(-6deg)_contrast(1.04)]"
            />

            <div className="absolute inset-0">
              <span className="globe-node-pulse absolute left-[48%] top-[34%] h-2 w-2 rounded-full bg-[#3b82f6]/85 shadow-[0_0_12px_4px_rgba(59,130,246,0.55)]" />
              <span className="globe-node-pulse absolute left-[56%] top-[48%] h-2.5 w-2.5 rounded-full bg-white/90 shadow-[0_0_16px_5px_rgba(59,130,246,0.55)] [animation-delay:0.8s]" />
              <span className="globe-node-pulse absolute left-[42%] top-[56%] h-1.5 w-1.5 rounded-full bg-[#3b82f6]/90 shadow-[0_0_10px_3px_rgba(59,130,246,0.5)] [animation-delay:1.6s]" />
              <span className="globe-node-pulse absolute left-[62%] top-[38%] h-2 w-2 rounded-full bg-[#60a5fa]/85 shadow-[0_0_14px_4px_rgba(59,130,246,0.5)] [animation-delay:2.2s]" />
            </div>
          </div>
        </div>
      </div>

      {/* Single symmetrical readability overlay — same navy tone all round */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,rgba(2,11,28,0.28)_0%,rgba(2,11,28,0.4)_50%,rgba(2,11,28,0.5)_100%)]" />
    </div>
  );
}
