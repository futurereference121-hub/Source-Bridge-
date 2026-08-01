"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { useAppUi } from "@/components/providers/AppProviders";
import type { AccountSession } from "@/lib/types";
import { useInboxUnread } from "@/hooks/useInboxUnread";
import { VerificationBadge } from "@/components/trust/VerificationBadge";
import { StoryAvatar } from "@/components/stories/StoryAvatar";
import { useStoriesOptional } from "@/components/stories/StoryProvider";
import { memberPhoto } from "@/lib/placeholders";

/**
 * Smart destination for a logged-in account's "home".
 * Mirrors the post-auth routing used across sign-in / verify / onboarding.
 */
export function accountHomePath(account: AccountSession | null): string {
  if (!account) return "/sign-in";
  if (!account.emailVerified) return "/check-email";
  if (!account.onboardingComplete) return "/onboarding";
  if (account.slug) return `/members/${account.slug}`;
  return "/profile";
}

function displayLabel(account: AccountSession | null): string {
  if (!account) return "Account";
  if (account.username) return `@${account.username}`;
  const first = account.name?.trim().split(/\s+/)[0];
  return first || "Account";
}

type MenuLink = { label: string; href: string };

/**
 * Logged-in account dropdown for the site header.
 * `variant` tweaks the trigger styling for the transparent home header
 * (outlined) vs. the solid navy internal header (plain text).
 */
export function AccountMenu({
  variant = "internal",
}: {
  variant?: "home" | "internal";
}) {
  const { account, signOut } = useAppUi();
  const stories = useStoriesOptional();
  const { unreadCount } = useInboxUnread();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (account?.id) void stories?.refreshRings([account.id]);
  }, [account?.id, stories?.refreshRings]);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isAdmin = Boolean(account?.role === "ADMIN" || account?.isAdmin);
  const isVerified = Boolean(
    account?.identityVerified ||
      account?.identityVerificationStatus === "VERIFIED",
  );
  const links: MenuLink[] = isAdmin
    ? [
        { label: "Verification Applicants", href: "/admin/verifications" },
        { label: "Change Password", href: "/admin/change-password" },
      ]
    : [
        { label: "My Profile", href: accountHomePath(account) },
        { label: "Inbox", href: "/inbox" },
        { label: "Manage Profile", href: "/profile" },
        { label: "Followers", href: "/profile/followers" },
        { label: "Following", href: "/profile/following" },
        { label: "Account Settings", href: "/profile/settings" },
      ];

  const triggerClass =
    variant === "home"
      ? "inline-flex h-10 items-center gap-1.5 rounded-lg border border-white/80 px-4 text-xs font-medium uppercase tracking-[0.14em] text-white transition-colors hover:bg-white/10"
      : "inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-medium uppercase tracking-[0.14em] text-white transition-colors hover:text-white/80";

  return (
    <div className="relative flex items-center gap-2" ref={ref}>
      {account?.id && !isAdmin ? (
        <StoryAvatar
          userId={account.id}
          isSelf
          size={36}
          className="rounded-lg ring-1 ring-white/15"
        >
          <Image
            src={memberPhoto(account.photo)}
            alt=""
            fill
            sizes="36px"
            unoptimized
            className="object-cover"
          />
        </StoryAvatar>
      ) : null}
      <button
        type="button"
        className={triggerClass}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="inline-flex max-w-[10rem] items-center gap-1 truncate normal-case tracking-normal">
          <span className="truncate">{displayLabel(account)}</span>
          {isVerified ? <VerificationBadge verified variant="tick" size="sm" /> : null}
        </span>
        <ChevronDown
          size={15}
          strokeWidth={2}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-60 overflow-hidden rounded-xl border border-white/12 bg-[#04122a] p-1.5 shadow-2xl shadow-black/40 ring-1 ring-electric/20"
        >
          <div className="border-b border-white/10 px-3 py-2.5">
            <p className="truncate text-sm font-medium text-white">
              {displayLabel(account)}
            </p>
            {account?.email ? (
              <p className="truncate text-xs text-white/45">{account.email}</p>
            ) : null}
          </div>

          <nav className="py-1">
            {links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-white/75 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <span>{link.label}</span>
                {link.href === "/inbox" && unreadCount > 0 ? (
                  <span className="rounded-full bg-electric px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>

          <div className="border-t border-white/10 pt-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/75 transition-colors hover:bg-electric/15 hover:text-white"
            >
              <LogOut size={15} strokeWidth={1.75} />
              Sign Out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Account-aware links for the mobile slide-down menu.
 * Rendered inline (not a dropdown) so it fits the existing mobile panel.
 */
export function AccountMenuMobileLinks({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const { account, signOut } = useAppUi();
  const { unreadCount } = useInboxUnread();

  const isAdmin = Boolean(account?.role === "ADMIN" || account?.isAdmin);
  const links: MenuLink[] = isAdmin
    ? [
        { label: "Verification Applicants", href: "/admin/verifications" },
        { label: "Change Password", href: "/admin/change-password" },
      ]
    : [
        { label: "My Profile", href: accountHomePath(account) },
        { label: "Inbox", href: "/inbox" },
        { label: "Manage Profile", href: "/profile" },
        { label: "Followers", href: "/profile/followers" },
        { label: "Following", href: "/profile/following" },
        { label: "Account Settings", href: "/profile/settings" },
      ];

  return (
    <>
      {links.map((link) => (
        <Link
          key={link.label}
          href={link.href}
          onClick={onNavigate}
          className="flex items-center justify-between py-3 text-sm font-medium uppercase tracking-[0.14em] text-white/80"
        >
          <span>{link.label}</span>
          {link.href === "/inbox" && unreadCount > 0 ? (
            <span className="rounded-full bg-electric px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Link>
      ))}
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          void signOut();
        }}
        className="flex items-center gap-2 py-3 text-left text-sm font-medium uppercase tracking-[0.14em] text-white/80"
      >
        <LogOut size={16} strokeWidth={1.75} />
        Sign Out
      </button>
    </>
  );
}
