import type { ActivityItemData } from "@/lib/types";

const TYPE_LABEL: Record<ActivityItemData["type"], string> = {
  listing: "Find",
  journey: "Journey",
  review: "Review",
  request: "Request",
  follow: "Follow",
};

type ActivityItemProps = {
  item: ActivityItemData;
};

export function ActivityItem({ item }: ActivityItemProps) {
  return (
    <li className="flex items-start justify-between gap-4 border-b border-border py-4 last:border-b-0">
      <div>
        <p className="text-[10px] uppercase tracking-[0.16em] text-muted">
          {TYPE_LABEL[item.type]}
        </p>
        <p className="mt-1 text-sm font-medium text-ink">{item.title}</p>
        <p className="mt-0.5 text-sm text-muted">{item.detail}</p>
      </div>
      <time className="shrink-0 text-xs text-muted-light">{item.dateLabel}</time>
    </li>
  );
}
