"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  Home,
  Inbox,
  MessageSquare,
  UserRound,
} from "lucide-react";
import { mobileNavItems } from "@/lib/site";
import { useAppUi } from "@/components/providers/AppProviders";
import { accountHomePath } from "@/components/layout/AccountMenu";

const ICONS = {
  "/": Home,
  "/explore": Compass,
  "/requests": Inbox,
  "/messages": MessageSquare,
  "/profile": UserRound,
} as const;

export function MobileNav() {
  const pathname = usePathname();
  const { signedIn, account } = useAppUi();

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
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={href}
                className={`flex h-full flex-col items-center justify-center gap-1 text-[10px] uppercase tracking-[0.12em] ${
                  active ? "text-electric" : "text-white/55"
                }`}
              >
                <Icon size={20} strokeWidth={active ? 1.75 : 1.5} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
