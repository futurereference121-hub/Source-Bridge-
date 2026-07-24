import Image from "next/image";
import Link from "next/link";
import type { Member } from "@/lib/types";
import { TrustBadgeRow } from "@/components/trust/TrustBadge";
import { BridgeScoreCard } from "@/components/trust/BridgeScoreCard";
import { Button } from "@/components/ui/Button";

type MemberCardProps = {
  member: Member;
  variant?: "compact" | "full";
};

/** Compact/full teaser card — links to the full member storefront. */
export function MemberCard({ member, variant = "full" }: MemberCardProps) {
  if (variant === "compact") {
    return (
      <Link
        href={`/members/${member.slug}`}
        className="flex items-start gap-4 border border-border bg-surface p-5 transition-colors hover:border-ink/30"
      >
        <div className="relative h-14 w-14 shrink-0 overflow-hidden bg-stone">
          <Image
            src={member.photo}
            alt={member.displayName}
            fill
            sizes="56px"
            className="object-cover"
          />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-xl text-ink">{member.displayName}</h3>
          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted">
            {member.currentLocation}
          </p>
          <p className="mt-2 text-xs text-muted">
            {member.countries.join(" · ")}
          </p>
        </div>
      </Link>
    );
  }

  return (
    <div className="overflow-hidden border border-border bg-surface">
      <div className="relative h-40 w-full bg-stone sm:h-52">
        <Image
          src={member.cover}
          alt=""
          fill
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/40 to-transparent" />
      </div>
      <div className="relative px-6 pb-8 pt-0 sm:px-8">
        <div className="relative -mt-12 mb-5 h-24 w-24 overflow-hidden border-4 border-surface bg-stone sm:h-28 sm:w-28">
          <Image
            src={member.photo}
            alt={member.displayName}
            fill
            sizes="112px"
            className="object-cover"
          />
        </div>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <h3 className="font-display text-3xl text-ink sm:text-4xl">
              {member.displayName}
            </h3>
            <p className="mt-2 text-xs uppercase tracking-[0.16em] text-muted">
              {member.currentLocation}
              <span className="mx-2 text-border">·</span>
              {member.countries.join(" · ")}
            </p>
            <p className="mt-5 text-base leading-relaxed text-muted">
              {member.bio}
            </p>
            <div className="mt-5">
              <TrustBadgeRow badges={member.badges.slice(0, 4)} />
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href={`/members/${member.slug}`} size="md">
                View Profile
              </Button>
              <Button variant="outline" size="md" disabled type="button">
                Contact — Coming Soon
              </Button>
            </div>
          </div>
          <BridgeScoreCard bridgeScore={member.bridgeScore} compact />
        </div>
      </div>
    </div>
  );
}
