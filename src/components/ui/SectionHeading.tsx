type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  tone?: "default" | "on-dark";
  className?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  tone = "default",
  className = "",
}: SectionHeadingProps) {
  const alignClass = align === "center" ? "text-center mx-auto" : "text-left";
  const eyebrowClass = tone === "on-dark" ? "text-white/55" : "text-muted";
  const titleClass = tone === "on-dark" ? "text-white" : "text-ink";
  const descClass = tone === "on-dark" ? "text-white/70" : "text-muted";

  return (
    <div className={`max-w-2xl ${alignClass} ${className}`}>
      {eyebrow ? (
        <p className={`mb-3 text-xs font-medium uppercase tracking-[0.2em] ${eyebrowClass}`}>
          {eyebrow}
        </p>
      ) : null}
      <h2
        className={`font-display text-3xl leading-tight sm:text-4xl md:text-5xl ${titleClass}`}
      >
        {title}
      </h2>
      {description ? (
        <p className={`mt-4 text-base leading-relaxed sm:text-lg ${descClass}`}>
          {description}
        </p>
      ) : null}
    </div>
  );
}
