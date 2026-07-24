type BridgeScoreProps = {
  score: number;
  compact?: boolean;
  note?: string;
};

export function BridgeScore({
  score,
  compact = false,
  note = "Placeholder — scoring logic coming soon",
}: BridgeScoreProps) {
  if (compact) {
    return (
      <div
        className="inline-flex items-baseline gap-1.5 border border-border bg-surface px-2.5 py-1.5"
        title={note}
      >
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted">
          Bridge
        </span>
        <span className="font-display text-xl text-ink">{score}</span>
      </div>
    );
  }

  return (
    <div className="border border-border bg-surface p-5" title={note}>
      <p className="text-xs uppercase tracking-[0.16em] text-muted">Bridge Score</p>
      <p className="mt-2 font-display text-4xl text-ink">{score}</p>
      <div className="mt-4 h-1.5 overflow-hidden bg-stone">
        <div
          className="h-full bg-accent transition-all duration-700"
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
      <p className="mt-3 text-xs text-muted">{note}</p>
    </div>
  );
}
