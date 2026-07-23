import Image from "next/image";
import type { Member } from "@/lib/types";

type MemberProfileCardProps = {
  member: Member;
  /** Compact for product cards / side panels; full for homepage / PDP. */
  variant?: "compact" | "full";
};

export function MemberProfileCard({
  member,
  variant = "full",
}: MemberProfileCardProps) {
  const capabilities = [
    member.offersPersonalSourcing ? "Personal sourcing" : null,
    member.offersRetailListings ? "Retail listings" : null,
    member.offersBusinessSourcing ? "Business sourcing" : null,
    member.worldwideShipping ? "Worldwide shipping" : null,
  ].filter(Boolean) as string[];

  if (variant === "compact") {
    return (
      <div className="flex items-start gap-4 border border-border bg-surface p-5">
        {member.avatar ? (
          <div className="relative h-14 w-14 shrink-0 overflow-hidden bg-stone">
            <Image
              src={member.avatar}
              alt={member.displayName}
              fill
              sizes="56px"
              className="object-cover"
            />
          </div>
        ) : null}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-xl text-ink">{member.displayName}</h3>
            {member.verified ? (
              <span className="border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted">
                Verified
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted">
            {member.countries.join(" · ")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-8 sm:grid-cols-[160px_1fr] sm:gap-10">
      {member.avatar ? (
        <div className="relative aspect-square overflow-hidden bg-stone sm:aspect-auto sm:h-40 sm:w-40">
          <Image
            src={member.avatar}
            alt={member.displayName}
            fill
            sizes="160px"
            className="object-cover"
          />
        </div>
      ) : null}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-display text-3xl text-ink sm:text-4xl">
            {member.displayName}
          </h3>
          {member.verified ? (
            <span
              className="border border-border px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted"
              title="Verified member — deeper identity checks coming soon"
            >
              Verified
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-muted">
          {member.countries.join(" · ")}
        </p>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted">
          {member.bio}
        </p>
        {capabilities.length > 0 ? (
          <ul className="mt-6 flex flex-wrap gap-2">
            {capabilities.map((label) => (
              <li
                key={label}
                className="border border-border px-3 py-1.5 text-xs uppercase tracking-[0.12em] text-ink"
              >
                {label}
              </li>
            ))}
          </ul>
        ) : null}
        {/* Future: messaging, reviews, trips, identity verification */}
        <p className="mt-6 text-sm text-muted">
          Contact member —{" "}
          <span className="italic">coming soon</span>
        </p>
      </div>
    </div>
  );
}
