"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  Home,
  Inbox,
  MessageSquare,
  Search,
  ShoppingBag,
  UserRound,
} from "lucide-react";
import { mobileNavItems } from "@/lib/site";
import { useAppUi } from "@/components/providers/AppProviders";
import { accountHomePath } from "@/components/layout/AccountMenu";
import { useInboxUnread } from "@/hooks/useInboxUnread";
import { useNotifications } from "@/hooks/useNotifications";

const ICONS = {
  "/": Home,
  "/search": Search,
  "/explore": Compass,
  "/requests": Inbox,
  "/inbox": MessageSquare,
  "/messages": MessageSquare,
  "/profile/purchases": ShoppingBag,
  "/profile": UserRound,
} as const;

export function MobileNav() {
  const pathname = usePathname();
  const { signedIn, account, signOut } = useAppUi();
  const { unreadCount } = useInboxUnread();
  const { unreadCount: unreadNotifications } = useNotifications();
  const isAdmin = Boolean(account?.role === "ADMIN" || account?.isAdmin);

  // Admins get a minimal two-item nav: verifications + logout.
  if (isAdmin && signedIn) {
    return (
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-navy/95 backdrop-blur-md md:hidden"
        aria-label="Admin mobile navigation"
      >
        <ul className="mx-auto flex h-16 max-w-lg items-stretch justify-between px-2">
          <li className="flex-1">
            <Link
              href="/admin/verifications"
              className={`relative flex h-full flex-col items-center justify-center gap-1 text-[10px] uppercase tracking-[0.12em] ${
                pathname.startsWith("/admin/verifications") ? "text-electric" : "text-white/55"
              }`}
            >
              <Inbox size={20} strokeWidth={pathname.startsWith("/admin") ? 1.75 : 1.5} />
              Applicants
            </Link>
          </li>
          <li className="flex-1">
            <button
              type="button"
              onClick={() => void signOut()}
              className="relative flex h-full w-full flex-col items-center justify-center gap-1 text-[10px] uppercase tracking-[0.12em] text-white/55"
            >
              <UserRound size={20} strokeWidth={1.5} />
              Sign Out
            </button>
          </li>
        </ul>
      </nav>
    );
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-navy/95 backdrop-blur-md md:hidden"
      aria-label="Mobile"
    >
      <ul className="mx-auto flex h-16 max-w-lg items-stretch justify-between px-2">
        {mobileNavItems.map((item) => {
          const Icon = ICONS[item.href as keyof typeof ICONS] ?? Home;
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const href =
            item.href === "/profile" && signedIn
              ? accountHomePath(account)
              : item.href;
          const showInboxBadge =
            signedIn && item.href === "/inbox" && unreadCount > 0;
          const showNotificationDot =
            signedIn && item.href === "/profile" && unreadNotifications > 0;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={href}
                className={`relative flex h-full flex-col items-center justify-center gap-1 text-[10px] uppercase tracking-[0.12em] ${
                  active ? "text-electric" : "text-white/55"
                }`}
              >
                <span className="relative">
                  <Icon size={20} strokeWidth={active ? 1.75 : 1.5} />
                  {showInboxBadge ? (
                    <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-electric px-1 text-[9px] font-semibold text-white">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  ) : null}
                  {showNotificationDot ? (
                    <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-navy" />
                  ) : null}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
