"use client";

import { useState } from "react";
import type { Member } from "@/lib/types";
import Link from "next/link";
import { VerificationBadge } from "@/components/trust/VerificationBadge";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { SafeMemberImage } from "@/components/ui/SafeMemberImage";
import { useAppUi } from "@/components/providers/AppProviders";
import { SourcingRequestComposer } from "@/components/messaging/SourcingRequestComposer";
import { memberPhoto } from "@/lib/placeholders";
import { StoryAvatar } from "@/components/stories/StoryAvatar";

type MemberCardProps = {
  member: Member;
};

function isIdentityVerified(member: Member): boolean {
  return Boolean(
    member.verification?.identityVerified ?? member.identityVerified,
  );
}

function displayMessage(member: Member): string {
  const raw = member.publicDisplayMessage ?? member.howICanHelp ?? "";
  return raw.trim();
}

function isRealMessagingTarget(member: Member): boolean {
  if (member.isDemo) return false;
  if (member.isPrototype) return false;
  if (member.isRealAccount === false) return false;
  // Seed IDs look like m-niran-chai; real Prisma ids are cuid-like.
  if (member.id.startsWith("m-")) return false;
  return true;
}

export function MemberCard({ member }: MemberCardProps) {
  const { account, requireAuth, showToast } = useAppUi();
  const verified = isIdentityVerified(member);
  const message = displayMessage(member);
  const networkPreview = member.network.slice(0, 3);
  const photo = memberPhoto(member.photo);
  const isOwner = Boolean(account && account.id === member.id);
  const canMessage = isRealMessagingTarget(member);
  const [composerOpen, setComposerOpen] = useState(false);

  function sendRequest() {
    if (isOwner) return;
    if (!canMessage) {
      showToast(
        "Showcase profiles cannot receive messages. Open a real member profile to send a sourcing request.",
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
    <article className="card-navy flex flex-col rounded-xl p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <StoryAvatar
          userId={member.id}
          isSelf={isOwner}
          profileHref={`/members/${member.slug}`}
          size={72}
        >
          <SafeMemberImage
            src={photo}
            alt={member.fullName}
            fill
            sizes="72px"
            className="object-cover"
          />
        </StoryAvatar>

        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-2">
            <Link
              href={`/members/${member.slug}`}
              className="min-w-0 truncate font-display text-xl text-white transition-colors hover:text-electric sm:text-2xl"
            >
              @{member.username}
            </Link>
            <span className="flex h-6 shrink-0 items-center justify-end">
              {verified ? <VerificationBadge verified size="sm" /> : null}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-white/55">{member.fullName}</p>
          <p className="mt-1 text-sm text-white/45">{member.location.label}</p>
          {member.isDemo ? (
            <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-electric/90">
              Showcase Profile
            </p>
          ) : null}
        </div>
      </div>

      {networkPreview.length ? (
        <div className="mt-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
            Network Reach
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-white/55">
            {networkPreview.map((n) => `${n.city}, ${n.country}`).join(" · ")}
            {member.network.length > 3
              ? ` · +${member.network.length - 3} more`
              : ""}
          </p>
        </div>
      ) : null}

      {message ? (
        <p className="mt-4 rounded-lg border border-electric/25 bg-electric/10 px-3 py-2 text-sm leading-snug text-white/85">
          {message}
        </p>
      ) : null}

      <div className="mt-auto pt-5">
        {isOwner ? (
          <PrimaryButton
            href="/profile"
            className="w-full rounded-lg"
            showArrow={false}
          >
            Manage Profile
          </PrimaryButton>
        ) : member.isDemo ? (
          <PrimaryButton
            href={`/members/${member.slug}`}
            className="w-full rounded-lg"
            showArrow={false}
          >
            View Showcase Profile
          </PrimaryButton>
        ) : (
          <PrimaryButton
            type="button"
            className="btn-glow-primary w-full rounded-lg"
            showArrow={false}
            onClick={sendRequest}
          >
            Send Sourcing Request
          </PrimaryButton>
        )}
        <Link
          href={`/members/${member.slug}`}
          className="mt-3 block rounded-lg border border-white/15 py-2.5 text-center text-xs font-medium uppercase tracking-[0.14em] text-white/75 transition-colors hover:border-electric/40 hover:text-white"
        >
          {member.isDemo ? "See How This Could Work" : "Explore Network"}
        </Link>
      </div>

      {canMessage && !isOwner ? (
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
    </article>
  );
}

/** Compact scannable Explore directory card — tap opens profile. */
export function MemberDirectoryCard({ member }: MemberCardProps) {
  const verified = isIdentityVerified(member);
  const photo = memberPhoto(member.photo);
  const message = displayMessage(member);
  const networkPreview = member.network.slice(0, 2);

  return (
    <Link
      href={`/members/${member.slug}`}
      className="card-navy flex flex-col rounded-xl p-3 transition-colors hover:border-electric/30 sm:p-3.5"
    >
      <div className="flex items-start gap-2.5">
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-navy-mid ring-1 ring-white/10 sm:h-12 sm:w-12">
          <SafeMemberImage
            src={photo}
            alt={member.fullName}
            fill
            sizes="48px"
            className="object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className="min-w-0 truncate text-sm font-medium text-white">
              {member.fullName}
            </p>
            {verified ? <VerificationBadge verified size="sm" variant="tick" /> : null}
          </div>
          <p className="truncate text-[12px] text-white/55">@{member.username}</p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/35">
            Current location
          </p>
          <p className="truncate text-[11px] text-white/45">{member.location.label}</p>
        </div>
      </div>
      {message ? (
        <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-white/65">
          {message}
        </p>
      ) : null}
      {networkPreview.length ? (
        <div className="mt-1.5">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/35">
            Network reach
          </p>
          <p className="truncate text-[10px] text-white/40">
            {networkPreview.map((n) => `${n.city}, ${n.country}`).join(" · ")}
            {member.network.length > 2
              ? ` · +${member.network.length - 2} more`
              : ""}
          </p>
        </div>
      ) : null}
    </Link>
  );
}

/** Compact row used in lists */
export function MemberCardCompact({ member }: MemberCardProps) {
  const photo = memberPhoto(member.photo);

  return (
    <Link
      href={`/members/${member.slug}`}
      className="card-navy flex items-start gap-4 rounded-xl p-4"
    >
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-navy-mid ring-1 ring-white/10">
        <SafeMemberImage
          src={photo}
          alt={member.fullName}
          fill
          sizes="56px"
          className="object-cover"
        />
      </div>
      <div className="min-w-0">
        <h3 className="font-display text-xl text-white">@{member.username}</h3>
        <p className="mt-0.5 text-sm text-white/55">{member.fullName}</p>
        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-white/40">
          {member.location.label}
        </p>
      </div>
    </Link>
  );
}
