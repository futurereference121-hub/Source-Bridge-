"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Member } from "@/lib/types";
import { VerificationBadge } from "@/components/trust/VerificationBadge";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { SafeMemberImage } from "@/components/ui/SafeMemberImage";
import { useAppUi } from "@/components/providers/AppProviders";
import { SourcingRequestComposer } from "@/components/messaging/SourcingRequestComposer";
import { memberCover } from "@/lib/placeholders";

type ProfileHeaderProps = {
  member: Member;
  isOwner: boolean;
};

function editHref(slug: string, edit: string) {
  return `/members/${slug}?edit=${edit}`;
}

function canReceiveMessages(member: Member): boolean {
  if (member.isDemo) return false;
  if (member.isPrototype) return false;
  if (member.isRealAccount === false) return false;
  if (member.id.startsWith("m-")) return false;
  return true;
}

export function ProfileHeader({ member, isOwner }: ProfileHeaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { follows, followMember, requireAuth, showToast } = useAppUi();
  const following = follows.includes(member.id);
  const [composerOpen, setComposerOpen] = useState(false);
  const messagingOk = canReceiveMessages(member);

  useEffect(() => {
    if (isOwner || !messagingOk) return;
    if (searchParams.get("compose") !== "1") return;
    setComposerOpen(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("compose");
    const qs = next.toString();
    router.replace(
      qs ? `/members/${member.slug}?${qs}` : `/members/${member.slug}`,
      { scroll: false },
    );
  }, [isOwner, messagingOk, member.slug, router, searchParams]);

  function sendRequest() {
    if (isOwner) return;
    if (!messagingOk) {
      showToast(
        "Showcase profiles cannot receive messages. Choose a real member account.",
      );
      return;
    }
    if (
      !requireAuth(
        "send a sourcing request",
        `/members/${member.slug}?compose=1`,
      )
    ) {
      return;
    }
    setComposerOpen(true);
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
            <SafeMemberImage
              src={member.photo}
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
              <span className="flex h-7 shrink-0 items-center justify-end">
                {member.verification.identityVerified ? (
                  <VerificationBadge verified size="md" />
                ) : null}
              </span>
            </div>
            <p className="mt-1 text-base text-white/60">{member.fullName}</p>
            <p className="mt-1.5 text-sm text-white/45">{member.location.label}</p>
            {member.isDemo ? (
              <p className="mt-2 inline-flex rounded-md border border-electric/35 bg-electric/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-electric">
                Showcase Profile
              </p>
            ) : null}
            {member.bio ? (
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/65">
                {member.bio}
              </p>
            ) : null}
            <div className="mt-3 flex gap-5 text-sm">
              <Link
                href={`/members/${member.slug}/followers`}
                className="text-white/55 hover:text-white"
              >
                <span className="font-semibold text-white">
                  {member.followerCount ?? 0}
                </span>{" "}
                followers
              </Link>
              <Link
                href={`/members/${member.slug}/following`}
                className="text-white/55 hover:text-white"
              >
                <span className="font-semibold text-white">
                  {member.followingCount ?? 0}
                </span>{" "}
                following
              </Link>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {isOwner ? (
            <PrimaryButton
              href={editHref(member.slug, "profile")}
              showArrow={false}
              className="rounded-lg"
            >
              Edit Profile
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
              {messagingOk ? (
                <PrimaryButton
                  type="button"
                  className="btn-glow-primary rounded-lg"
                  showArrow={false}
                  onClick={sendRequest}
                >
                  Send Sourcing Request
                </PrimaryButton>
              ) : member.isDemo ? (
                <span className="inline-flex h-11 items-center rounded-lg border border-white/20 px-5 text-xs font-medium uppercase tracking-[0.14em] text-white/55">
                  Showcase only — messaging disabled
                </span>
              ) : null}
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
          Add a public display message via{" "}
          <Link
            href={editHref(member.slug, "profile")}
            className="text-electric hover:text-electric-hover"
          >
            Edit Profile
          </Link>
          .
        </div>
      ) : null}

      {!isOwner && messagingOk ? (
        <SourcingRequestComposer
          open={composerOpen}
          onClose={() => setComposerOpen(false)}
          recipient={{
            id: member.id,
            username: member.username,
            fullName: member.fullName,
            photo: member.photo,
            locationLabel: member.location.label,
            isRealAccount: true,
          }}
        />
      ) : null}
    </div>
  );
}
