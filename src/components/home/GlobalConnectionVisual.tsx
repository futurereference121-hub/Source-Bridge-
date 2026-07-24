/**
 * Local decorative globe — continent silhouettes, illuminated cities, thin arcs.
 * Pure SVG/CSS; no remote assets.
 */
export function GlobalConnectionVisual({ className = "" }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none absolute inset-y-0 right-0 w-full max-w-[780px] select-none opacity-[0.38] sm:opacity-70 md:opacity-100 ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 720 720"
        className="h-full w-full origin-right scale-[1.2] translate-x-[12%] sm:translate-x-[6%] lg:translate-x-0 lg:scale-[1.12]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="globeFade" cx="58%" cy="48%" r="52%">
            <stop offset="0%" stopColor="#0a2a55" stopOpacity="0.65" />
            <stop offset="55%" stopColor="#041a36" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#020c1d" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="globeCore" cx="55%" cy="45%" r="48%">
            <stop offset="0%" stopColor="#1769E8" stopOpacity="0.14" />
            <stop offset="70%" stopColor="#041a36" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#020c1d" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="arcGlow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1769E8" stopOpacity="0" />
            <stop offset="40%" stopColor="#7eb0ff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#1769E8" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="landFill" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1769E8" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#7eb0ff" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="edgeFade" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#020c1d" stopOpacity="0" />
            <stop offset="100%" stopColor="#020c1d" stopOpacity="0.92" />
          </linearGradient>
          <clipPath id="globeClip">
            <circle cx="400" cy="360" r="248" />
          </clipPath>
          <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx="400" cy="360" r="290" fill="url(#globeFade)" />
        <circle cx="400" cy="360" r="255" fill="url(#globeCore)" />

        {/* Latitude / longitude grid */}
        <g stroke="#1769E8" strokeOpacity="0.26" strokeWidth="1">
          <ellipse cx="400" cy="360" rx="248" ry="248" />
          <ellipse cx="400" cy="360" rx="248" ry="90" />
          <ellipse cx="400" cy="360" rx="248" ry="160" />
          <ellipse cx="400" cy="360" rx="248" ry="210" />
          <ellipse cx="400" cy="360" rx="90" ry="248" />
          <ellipse cx="400" cy="360" rx="160" ry="248" />
          <ellipse cx="400" cy="360" rx="210" ry="248" />
          <line x1="152" y1="360" x2="648" y2="360" />
          <line x1="400" y1="112" x2="400" y2="608" />
        </g>

        <g stroke="#8eb8ff" strokeOpacity="0.07" strokeWidth="0.6">
          <ellipse cx="400" cy="360" rx="248" ry="40" />
          <ellipse cx="400" cy="360" rx="248" ry="125" />
          <ellipse cx="400" cy="360" rx="248" ry="185" />
          <ellipse cx="400" cy="360" rx="248" ry="230" />
          <ellipse cx="400" cy="360" rx="40" ry="248" />
          <ellipse cx="400" cy="360" rx="125" ry="248" />
          <ellipse cx="400" cy="360" rx="185" ry="248" />
        </g>

        {/* Stylized Europe / Africa / Near East — clipped to globe */}
        <g clipPath="url(#globeClip)" fill="url(#landFill)" stroke="#7eb0ff" strokeOpacity="0.35" strokeWidth="0.8">
          {/* Europe */}
          <path d="M355 245 C368 232 390 228 412 236 C430 244 442 258 448 278 C438 286 420 290 402 286 C384 282 368 270 355 245Z" />
          {/* Iberia / UK suggestion */}
          <path d="M332 268 C342 258 352 262 356 274 C348 282 336 280 332 268Z" />
          <path d="M348 228 C356 220 366 224 368 236 C360 240 350 236 348 228Z" />
          {/* Africa */}
          <path d="M368 295 C392 288 418 292 438 312 C452 332 458 362 452 398 C444 438 422 468 398 482 C378 492 358 484 348 458 C336 422 332 378 340 342 C348 318 356 302 368 295Z" />
          {/* Horn / Arabia hint */}
          <path d="M448 340 C468 332 488 338 502 358 C492 372 470 368 452 360 C448 352 448 340 448 340Z" />
          {/* Near East / Anatolia */}
          <path d="M448 278 C468 272 490 278 502 298 C486 308 464 302 448 292 C444 286 448 278 448 278Z" />
        </g>

        {/* Connection arcs */}
        <g filter="url(#softGlow)" stroke="url(#arcGlow)" strokeWidth="1.5" fill="none">
          <path d="M220 290 C 300 180, 480 170, 560 250" className="globe-arc" />
          <path d="M250 420 C 340 330, 470 300, 580 360" className="globe-arc" />
          <path d="M280 220 C 360 260, 430 340, 470 470" className="globe-arc" />
          <path d="M200 360 C 310 250, 450 240, 540 310" className="globe-arc" />
          <path d="M310 500 C 380 430, 500 390, 560 420" className="globe-arc" />
          <path d="M360 250 C 410 280, 470 320, 520 380" />
        </g>

        {/* Illuminated cities */}
        <g filter="url(#softGlow)" className="globe-nodes">
          {[
            [260, 280, 3.2],
            [320, 230, 2.4],
            [380, 300, 3.6],
            [450, 250, 2.8],
            [520, 290, 3.4],
            [300, 380, 2.6],
            [370, 420, 3.0],
            [440, 380, 2.2],
            [500, 400, 3.2],
            [340, 480, 2.4],
            [420, 470, 2.8],
            [480, 330, 2.2],
            [240, 350, 2.0],
            [560, 350, 2.6],
            [400, 200, 2.2],
            [390, 340, 2.8],
            [410, 390, 2.4],
          ].map(([x, y, r], i) => (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={r}
              fill={i % 3 === 0 ? "#ffffff" : "#7eb0ff"}
              fillOpacity={0.95}
              className={i % 4 === 0 ? "globe-node-pulse" : undefined}
            />
          ))}
        </g>

        <rect x="0" y="0" width="300" height="720" fill="url(#edgeFade)" />
      </svg>

      <div className="absolute inset-0 bg-gradient-to-r from-[#020c1d] via-[#020c1d]/50 to-transparent sm:via-[#020c1d]/18" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#020c1d] to-transparent" />
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#020c1d]/85 to-transparent" />
    </div>
  );
}
