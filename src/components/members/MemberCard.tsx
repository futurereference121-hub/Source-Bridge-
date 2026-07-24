"use client";

import Image from "next/image";
import Link from "next/link";
import { Star } from "lucide-react";
import type { Member } from "@/lib/types";
import { VerificationBadge } from "@/components/trust/VerificationBadge";
import { BridgeScore } from "@/components/trust/BridgeScore";
import { ServiceTag } from "@/components/members/ServiceTag";
import { AvailabilityBadge } from "@/components/members/AvailabilityBadge";
import { Button } from "@/components/ui/Button";
import { useAppUi } from "@/components/providers/AppProviders";
import { memberTypeLabels } from "@/lib/site";

type MemberCardProps = {
  member: Member;
};

export function MemberCard({ member }: MemberCardProps) {
  const { follows, followMember } = useAppUi();
  const following = follows.includes(member.id);
  const countries = member.connectedCountries.map((c) => c.country);

  return (
    <article className="flex flex-col overflow-hidden border border-border bg-surface transition-colors hover:border-ink/25">
      <div className="relative h-36 w-full bg-stone sm:h-40">
        <Image
          src={member.cover}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/45 to-transparent" />
        <div className="absolute bottom-3 left-3">
          <AvailabilityBadge
            status={member.availability}
            label={member.availabilityLabel}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 pb-5 pt-0">
        <div className="relative -mt-10 mb-4 flex items-end justify-between gap-3">
          <div className="relative h-20 w-20 overflow-hidden border-4 border-surface bg-stone">
            <Image
              src={member.photo}
              alt={member.fullName}
              fill
              sizes="80px"
              className="object-cover"
            />
          </div>
          <BridgeScore score={member.bridgeScore} compact />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-2xl text-ink">{member.fullName}</h3>
          {member.verification.identityVerified ? (
            <VerificationBadge verified />
          ) : null}
        </div>

        <p className="mt-1 text-sm text-muted">
          {member.location.label}
          <span className="mx-2 text-border">·</span>
          {memberTypeLabels[member.memberType] ?? member.memberType}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
          <span className="inline-flex items-center gap-1">
            <Star size={14} className="fill-accent text-accent" strokeWidth={1.5} />
            {member.rating.toFixed(1)}
          </span>
          <span>{member.completedRequests} completed</span>
        </div>

        <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-ink/80">
          {member.howICanHelp}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {member.services.slice(0, 4).map((service) => (
            <ServiceTag key={service.id} label={service.label} />
          ))}
        </div>

        <p className="mt-4 text-xs uppercase tracking-[0.12em] text-muted">
          {countries.slice(0, 4).join(" · ")}
          {countries.length > 4 ? " · +" + (countries.length - 4) : ""}
        </p>

        {member.upcomingJourney ? (
          <p className="mt-3 border-t border-border pt-3 text-sm text-muted">
            Next: {member.upcomingJourney.from} → {member.upcomingJourney.to}
            <span className="mx-1.5 text-border">·</span>
            {member.upcomingJourney.datesLabel}
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          <Button
            type="button"
            variant={following ? "secondary" : "outline"}
            size="sm"
            onClick={() => followMember(member.id, member.fullName)}
          >
            {following ? "Following" : "Follow"}
          </Button>
          <Button href={`/members/${member.slug}`} size="sm">
            View Profile
          </Button>
        </div>
      </div>
    </article>
  );
}

/** Compact row used in lists */
export function MemberCardCompact({ member }: MemberCardProps) {
  return (
    <Link
      href={`/members/${member.slug}`}
      className="flex items-start gap-4 border border-border bg-surface p-4 transition-colors hover:border-ink/30"
    >
      <div className="relative h-14 w-14 shrink-0 overflow-hidden bg-stone">
        <Image
          src={member.photo}
          alt={member.fullName}
          fill
          sizes="56px"
          className="object-cover"
        />
      </div>
      <div className="min-w-0">
        <h3 className="font-display text-xl text-ink">{member.fullName}</h3>
        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted">
          {member.location.label}
        </p>
      </div>
    </Link>
  );
}
