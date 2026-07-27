"use client";

import Image from "next/image";
import Link from "next/link";
import type { Member } from "@/lib/types";
import { VerificationBadge } from "@/components/trust/VerificationBadge";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { memberPhoto } from "@/lib/placeholders";

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

export function MemberCard({ member }: MemberCardProps) {
  const { requireAuth, openPlaceholder } = useAppUi();
  const verified = isIdentityVerified(member);
  const message = displayMessage(member);
  const networkPreview = member.network.slice(0, 3);
  const photo = memberPhoto(member.photo);

  function sendRequest() {
    if (!requireAuth("send a sourcing request")) return;
    openPlaceholder(
      "Sourcing request",
      `Your request to @${member.username} will open here. Prototype placeholder — messaging connects later.`,
    );
  }

  return (
    <article className="card-navy flex flex-col rounded-xl p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <Link
          href={`/members/${member.slug}`}
          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-navy-mid ring-1 ring-white/10 sm:h-[72px] sm:w-[72px]"
        >
          <Image
            src={photo}
            alt={member.fullName}
            fill
            sizes="72px"
            unoptimized={photo.startsWith("data:")}
            className="object-cover"
          />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-2">
            <Link
              href={`/members/${member.slug}`}
              className="min-w-0 truncate font-display text-xl text-white transition-colors hover:text-electric sm:text-2xl"
            >
              @{member.username}
            </Link>
            <span className="flex h-6 w-[5.5rem] shrink-0 items-center justify-end">
              {verified ? (
                <VerificationBadge verified variant="dark" />
              ) : null}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-white/55">{member.fullName}</p>
          <p className="mt-1 text-sm text-white/45">{member.location.label}</p>
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
        <PrimaryButton
          type="button"
          className="btn-glow-primary w-full rounded-lg"
          showArrow={false}
          onClick={sendRequest}
        >
          Send Sourcing Request
        </PrimaryButton>
        <Link
          href={`/members/${member.slug}`}
          className="mt-3 block rounded-lg border border-white/15 py-2.5 text-center text-xs font-medium uppercase tracking-[0.14em] text-white/75 transition-colors hover:border-electric/40 hover:text-white"
        >
          Explore Network
        </Link>
      </div>
    </article>
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
        <Image
          src={photo}
          alt={member.fullName}
          fill
          sizes="56px"
          unoptimized={photo.startsWith("data:")}
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
