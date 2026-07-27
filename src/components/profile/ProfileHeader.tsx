"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { Member } from "@/lib/types";
import { VerificationBadge } from "@/components/trust/VerificationBadge";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { memberCover, memberPhoto } from "@/lib/placeholders";

type ProfileHeaderProps = {
  member: Member;
  isOwner: boolean;
};

function editHref(slug: string, edit: string) {
  return `/members/${slug}?edit=${edit}`;
}

export function ProfileHeader({ member, isOwner }: ProfileHeaderProps) {
  const router = useRouter();
  const { follows, followMember, requireAuth, showToast } = useAppUi();
  const following = follows.includes(member.id);
  const [requestBusy, setRequestBusy] = useState(false);

  async function sendRequest() {
    if (!requireAuth("send a sourcing request")) return;
    const message = window.prompt(
      `Message for @${member.username}`,
      "Hi — I'd like to send a sourcing request.",
    );
    if (message === null) return;
    const trimmed = message.trim();
    if (!trimmed) {
      showToast("Message required");
      return;
    }

    setRequestBusy(true);
    try {
      const res = await fetch("/api/sourcing-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toUserId: member.id,
          message: trimmed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send request");
      const conversationId = data.conversation?.id as string | undefined;
      showToast(
        data.existing ? "Opening existing conversation" : "Sourcing request sent",
      );
      router.push(
        conversationId ? `/messages?c=${conversationId}` : "/messages",
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not send request");
    } finally {
      setRequestBusy(false);
    }
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

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {isOwner ? (
            <>
              <PrimaryButton
                href={editHref(member.slug, "profile")}
                showArrow={false}
                className="rounded-lg"
              >
                Edit Profile
              </PrimaryButton>
              <OwnerAction href={editHref(member.slug, "status")}>
                Update Status
              </OwnerAction>
              <OwnerAction href={editHref(member.slug, "opportunity")}>
                Post Opportunity
              </OwnerAction>
              <OwnerAction href={editHref(member.slug, "travel")}>
                Edit Upcoming Travel
              </OwnerAction>
              <OwnerAction href={editHref(member.slug, "listing")}>
                Manage Listings
              </OwnerAction>
              <OwnerAction href="/messages">Messages</OwnerAction>
              <OwnerAction href="/profile/settings">Account Settings</OwnerAction>
            </>
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
                disabled={requestBusy}
                onClick={() => void sendRequest()}
              >
                {requestBusy ? "Sending…" : "Send Sourcing Request"}
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
    </div>
  );
}

function OwnerAction({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 items-center rounded-lg border border-white/25 px-4 text-xs font-medium uppercase tracking-[0.14em] text-white/85 hover:border-white/50 hover:bg-white/5 sm:px-5"
    >
      {children}
    </Link>
  );
}
