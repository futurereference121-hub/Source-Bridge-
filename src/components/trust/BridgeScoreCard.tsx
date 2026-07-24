import type { BridgeScorePlaceholder } from "@/lib/types";

type BridgeScoreCardProps = {
  bridgeScore: BridgeScorePlaceholder;
  compact?: boolean;
};

export function BridgeScoreCard({ bridgeScore, compact = false }: BridgeScoreCardProps) {
  if (compact) {
    return (
      <div
        className="inline-flex items-baseline gap-2 border border-border bg-surface px-3 py-2"
        title={bridgeScore.note}
      >
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted">
          {bridgeScore.label}
        </span>
        <span className="font-display text-2xl text-ink">{bridgeScore.score}</span>
      </div>
    );
  }

  return (
    <div
      className="border border-border bg-surface p-6"
      title={bridgeScore.note}
    >
      <p className="text-xs uppercase tracking-[0.18em] text-muted">
        {bridgeScore.label}
      </p>
      <p className="mt-3 font-display text-5xl text-ink">{bridgeScore.score}</p>
      <p className="mt-3 text-sm text-muted">{bridgeScore.note}</p>
      <div className="mt-5 h-1.5 overflow-hidden bg-stone">
        <div
          className="h-full bg-accent transition-all duration-700"
          style={{ width: `${Math.min(100, Math.max(0, bridgeScore.score))}%` }}
        />
      </div>
    </div>
  );
}
