import type { JourneyPlaceholder } from "@/lib/types";
import { ArrowRight, Plane } from "lucide-react";

type JourneyCardProps = {
  journey: JourneyPlaceholder;
};

export function JourneyCard({ journey }: JourneyCardProps) {
  return (
    <article className="border border-border bg-surface p-5 transition-colors hover:border-ink/25">
      <div className="flex items-center gap-2 text-accent">
        <Plane size={16} strokeWidth={1.5} />
        <span className="text-[10px] uppercase tracking-[0.16em]">
          Upcoming journey
        </span>
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-2 font-display text-2xl text-ink">
        <span>{journey.from}</span>
        <ArrowRight size={18} strokeWidth={1.5} className="text-muted" />
        <span>{journey.to}</span>
      </p>
      <p className="mt-2 text-sm text-muted">{journey.datesLabel}</p>
      {journey.note ? (
        <p className="mt-3 text-sm leading-relaxed text-muted">{journey.note}</p>
      ) : null}
      <p className="mt-4 text-xs italic text-muted-light">
        Journey matching — coming soon
      </p>
    </article>
  );
}

type JourneyGridProps = {
  journeys: JourneyPlaceholder[];
};

export function JourneyGrid({ journeys }: JourneyGridProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {journeys.map((journey) => (
        <JourneyCard key={journey.id} journey={journey} />
      ))}
    </div>
  );
}
