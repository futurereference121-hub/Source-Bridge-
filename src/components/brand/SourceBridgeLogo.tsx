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
  navy: "#020C1D",
  electric: "#1769E8",
} as const;

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
        <circle
          cx="24"
          cy="24"
          r="22.5"
          stroke={fill}
          strokeWidth="2"
          fill="none"
        />
        {/* Left person */}
        <circle cx="16.5" cy="17" r="2.4" fill={fill} />
        <path
          d="M12.2 28.5c1.1-4.2 3.2-6.3 4.3-6.3s3.2 2.1 4.3 6.3"
          stroke={fill}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
        {/* Right person */}
        <circle cx="31.5" cy="17" r="2.4" fill={fill} />
        <path
          d="M27.2 28.5c1.1-4.2 3.2-6.3 4.3-6.3s3.2 2.1 4.3 6.3"
          stroke={fill}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
        {/* Bridge curve connecting the two */}
        <path
          d="M18.8 22.8c2.2-3.2 8.2-3.2 10.4 0"
          stroke={fill}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
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
