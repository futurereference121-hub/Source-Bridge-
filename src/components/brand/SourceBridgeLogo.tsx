type SourceBridgeLogoProps = {
  /** Icon diameter in pixels */
  size?: number;
  /** Icon fill / stroke color */
  color?: "white" | "navy" | "electric";
  /** Show SOURCE BRIDGE wordmark beside icon */
  withWordmark?: boolean;
  className?: string;
  wordmarkClassName?: string;
};

const COLORS = {
  white: "#ffffff",
  navy: "#020B1C",
  electric: "#3B82F6",
} as const;

/** Six outer nodes + six spokes + central point (no outer ring / chord geometry). */
const NODE_RADIUS = 18;
const OUTER_R = 2.6;
const CENTER_R = 2.2;
const OUTER_NODES = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 2) * -1 + (i * Math.PI) / 3;
  return {
    x: 24 + NODE_RADIUS * Math.cos(angle),
    y: 24 + NODE_RADIUS * Math.sin(angle),
  };
});

export function SourceBridgeLogo({
  size = 36,
  color = "white",
  withWordmark = false,
  className = "",
  wordmarkClassName = "",
}: SourceBridgeLogoProps) {
  const fill = COLORS[color];

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden={!withWordmark}
        role={withWordmark ? "img" : undefined}
        aria-label={withWordmark ? undefined : "Source Bridge"}
      >
        <title>Source Bridge</title>
        {OUTER_NODES.map((node, i) => (
          <line
            key={`spoke-${i}`}
            x1={24}
            y1={24}
            x2={node.x}
            y2={node.y}
            stroke={fill}
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity={0.85}
          />
        ))}
        {OUTER_NODES.map((node, i) => (
          <circle
            key={`node-${i}`}
            cx={node.x}
            cy={node.y}
            r={OUTER_R}
            fill={fill}
          />
        ))}
        {/* Soft central glow — simplified for header scale */}
        <circle cx={24} cy={24} r={5.5} fill={fill} opacity={0.18} />
        <circle cx={24} cy={24} r={CENTER_R} fill={fill} />
      </svg>
      {withWordmark ? (
        <span
          className={`text-[13px] font-semibold uppercase tracking-[0.16em] sm:text-sm ${wordmarkClassName}`}
          style={{ color: fill }}
        >
          Source Bridge
        </span>
      ) : null}
    </span>
  );
}
