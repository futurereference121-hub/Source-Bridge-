"use client";

import Image from "next/image";
import { Bookmark, MessageCircle, Star } from "lucide-react";
import type { Member } from "@/lib/types";
import { VerificationBadge } from "@/components/trust/VerificationBadge";
import { BridgeScore } from "@/components/trust/BridgeScore";
import { AvailabilityBadge } from "@/components/members/AvailabilityBadge";
import { Button } from "@/components/ui/Button";
import { useAppUi } from "@/components/providers/AppProviders";
import { memberTypeLabels } from "@/lib/site";

type ProfileHeaderProps = {
  member: Member;
};

export function ProfileHeader({ member }: ProfileHeaderProps) {
  const { follows, savedProfiles, followMember, saveProfile, openPlaceholder } =
    useAppUi();
  const following = follows.includes(member.id);
  const saved = savedProfiles.includes(member.id);

  return (
    <div>
      <div className="relative h-48 w-full bg-stone sm:h-64 md:h-72">
        <Image
          src={member.cover}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/25 to-transparent" />
      </div>

      <div className="relative -mt-14 flex flex-col gap-6 sm:-mt-16 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
          <div className="relative h-28 w-28 overflow-hidden border-4 border-background bg-stone sm:h-32 sm:w-32">
            <Image
              src={member.photo}
              alt={member.fullName}
              fill
              sizes="128px"
              className="object-cover"
              priority
            />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-4xl text-ink sm:text-5xl">
                {member.fullName}
              </h1>
              {member.verification.identityVerified ? (
                <VerificationBadge verified size="md" />
              ) : null}
            </div>
            <p className="mt-2 text-sm text-muted">
              {member.location.label}
              <span className="mx-2 text-border">·</span>
              {memberTypeLabels[member.memberType] ?? member.memberType}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <AvailabilityBadge
                status={member.availability}
                label={member.availabilityLabel}
              />
              <span className="inline-flex items-center gap-1 text-sm text-muted">
                <Star size={14} className="fill-accent text-accent" strokeWidth={1.5} />
                {member.rating.toFixed(1)}
              </span>
              <span className="text-sm text-muted">
                {member.completedRequests} completed requests
              </span>
            </div>
            {member.isPrototype ? (
              <p className="mt-2 text-xs text-muted-light">Prototype profile</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <BridgeScore score={member.bridgeScore} compact />
          <Button
            type="button"
            variant={following ? "secondary" : "outline"}
            size="md"
            onClick={() => followMember(member.id, member.fullName)}
          >
            {following ? "Following" : "Follow"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => saveProfile(member.id, member.fullName)}
            aria-label={saved ? "Unsave profile" : "Save profile"}
          >
            <Bookmark size={16} strokeWidth={1.5} className={saved ? "fill-ink" : ""} />
            {saved ? "Saved" : "Save"}
          </Button>
          <Button
            type="button"
            size="md"
            onClick={() =>
              openPlaceholder(
                "Message / Request",
                "Direct messaging and sourcing requests will connect here. This is a prototype placeholder.",
              )
            }
          >
            <MessageCircle size={16} strokeWidth={1.5} />
            Message / Request
          </Button>
        </div>
      </div>
    </div>
  );
}
