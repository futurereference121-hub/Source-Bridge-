import { BridgeScore } from "@/components/trust/BridgeScore";

/** @deprecated Prefer BridgeScore — kept for older imports. */
export function BridgeScoreCard({
  bridgeScore,
  compact = false,
}: {
  bridgeScore: { score: number; label?: string; note?: string } | number;
  compact?: boolean;
}) {
  const score =
    typeof bridgeScore === "number" ? bridgeScore : bridgeScore.score;
  const note =
    typeof bridgeScore === "number" ? undefined : bridgeScore.note;
  return <BridgeScore score={score} compact={compact} note={note} />;
}
