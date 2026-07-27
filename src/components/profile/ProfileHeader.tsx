"use client";

import Image from "next/image";
import Link from "next/link";
import type { Member } from "@/lib/types";
import { VerificationBadge } from "@/components/trust/VerificationBadge";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { memberCover, memberPhoto } from "@/lib/placeholders";

type ProfileHeaderProps = {
  member: Member;
  isOwner: boolean;
};

export function ProfileHeader({ member, isOwner }: ProfileHeaderProps) {
  const { follows, followMember, requireAuth, openPlaceholder } = useAppUi();
  const following = follows.includes(member.id);

  function sendRequest() {
    if (!requireAuth("send a sourcing request")) return;
    openPlaceholder(
      "Sourcing request",
      `Your request to @${member.username} will open here. Prototype placeholder — messaging connects later.`,
    );
  }

  return (
    <div>
      <div className="relative h-48 w-full overflow-hidden rounded-xl bg-navy-mid sm:h-56 md:h-64">
        <Image
          src={memberCover(member.cover)}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#020b1c] via-[#020b1c]/70 to-[#020b1c]/25" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(59,130,246,0.22),transparent_55%)]" />
      </div>

      <div className="relative -mt-14 flex flex-col gap-6 sm:-mt-16 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="relative h-24 w-24 overflow-hidden rounded-xl border-[3px] border-[#020b1c] bg-navy-mid shadow-[0_0_32px_rgba(59,130,246,0.18)] sm:h-28 sm:w-28">
            <Image
              src={memberPhoto(member.photo)}
              alt={member.fullName}
              fill
              sizes="112px"
              className="object-cover"
              priority
            />
          </div>
          <div className="min-w-0">
            <div className="grid grid-cols-[1fr_auto] items-center gap-x-2">
              <h1 className="min-w-0 truncate font-display text-3xl text-white sm:text-4xl">
                @{member.username}
              </h1>
              <span className="flex h-7 w-[6.5rem] shrink-0 items-center justify-end">
                {member.verification.identityVerified ? (
                  <VerificationBadge verified size="md" variant="dark" />
                ) : null}
              </span>
            </div>
            <p className="mt-1 text-base text-white/60">{member.fullName}</p>
            <p className="mt-1.5 text-sm text-white/45">{member.location.label}</p>
            {member.bio ? (
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/65">
                {member.bio}
              </p>
            ) : null}
            <div className="mt-3 flex gap-5 text-sm">
              <Link href={`/members/${member.slug}/followers`} className="text-white/55 hover:text-white">
                <span className="font-semibold text-white">{member.followerCount ?? 0}</span> followers
              </Link>
              <Link href={`/members/${member.slug}/following`} className="text-white/55 hover:text-white">
                <span className="font-semibold text-white">{member.followingCount ?? 0}</span> following
              </Link>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isOwner ? (
            <PrimaryButton href="/profile" showArrow={false} className="rounded-lg">
              Edit / Manage Profile
            </PrimaryButton>
          ) : (
            <>
          <button
            type="button"
            onClick={() => followMember(member.id, `@${member.username}`)}
            className={`inline-flex h-11 items-center rounded-lg border px-5 text-xs font-medium uppercase tracking-[0.14em] transition-colors ${
              following
                ? "border-electric/40 bg-electric/15 text-electric"
                : "border-white/25 text-white/85 hover:border-white/50 hover:bg-white/5"
            }`}
          >
            {following ? "Following" : "Follow"}
          </button>
          <PrimaryButton
            type="button"
            className="btn-glow-primary rounded-lg"
            showArrow={false}
            onClick={sendRequest}
          >
            Send Sourcing Request
          </PrimaryButton>
            </>
          )}
        </div>
      </div>
      {(member.publicDisplayMessage || member.howICanHelp)?.trim() ? (
        <div className="mt-7 rounded-xl border border-electric/30 bg-electric/10 px-5 py-4 text-sm leading-relaxed text-white/85">
          {(member.publicDisplayMessage || member.howICanHelp).trim()}
        </div>
      ) : isOwner ? (
        <div className="mt-7 rounded-xl border border-dashed border-white/10 px-5 py-4 text-sm text-white/35">
          Add a public display message from Manage Profile.
        </div>
      ) : null}
    </div>
  );
}
