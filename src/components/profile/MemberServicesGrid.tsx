import type { Member } from "@/lib/types";
import { SERVICE_META, getActiveServices } from "@/lib/services";

type MemberServicesGridProps = {
  member: Member;
};

export function MemberServicesGrid({ member }: MemberServicesGridProps) {
  const active = getActiveServices(member.services);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {active.map((key) => {
        const meta = SERVICE_META[key];
        const Icon = meta.icon;
        return (
          <div
            key={key}
            className="border border-border bg-surface p-5 transition-colors hover:border-ink/25"
          >
            <Icon className="text-accent" size={22} strokeWidth={1.5} />
            <h3 className="mt-4 font-display text-xl text-ink">{meta.label}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {meta.description}
            </p>
          </div>
        );
      })}
    </div>
  );
}
