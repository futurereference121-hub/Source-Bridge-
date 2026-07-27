"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { homeNavItems, navItems } from "@/lib/site";
import { useAppUi } from "@/components/providers/AppProviders";
import { SourceBridgeLogo } from "@/components/brand/SourceBridgeLogo";
import {
  AccountMenu,
  AccountMenuMobileLinks,
} from "@/components/layout/AccountMenu";

export function SiteHeader() {
  const pathname = usePathname();
  const { signedIn } = useAppUi();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isHome = pathname === "/";

  const desktopNav = (isHome ? homeNavItems : navItems).filter((item) => {
    if (isHome) return true;
    if (item.href === "/sign-in" && signedIn) return false;
    if (item.href === "/join" && signedIn) return false;
    return true;
  });

  if (isHome) {
    return (
      <header className="absolute inset-x-0 top-0 z-50">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:h-20 sm:px-8 lg:px-10">
          <Link href="/" className="inline-flex items-center" aria-label="Source Bridge home">
            <SourceBridgeLogo size={34} color="white" withWordmark wordmarkClassName="text-white" />
          </Link>

          <nav className="hidden items-center gap-6 sm:flex">
            <Link
              href="/how-it-works"
              className="text-xs font-medium uppercase tracking-[0.16em] text-white/90 transition-colors hover:text-white"
            >
              How It Works
            </Link>
            {signedIn ? (
              <AccountMenu variant="home" />
            ) : (
              <Link
                href="/sign-in"
                className="inline-flex h-10 items-center rounded-lg border border-white/80 px-4 text-xs font-medium uppercase tracking-[0.14em] text-white transition-colors hover:bg-white/10"
              >
                Sign In / Up
              </Link>
            )}
          </nav>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center text-white sm:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={22} strokeWidth={1.5} /> : <Menu size={22} strokeWidth={1.5} />}
          </button>
        </div>

        {open ? (
          <div className="border-t border-white/10 bg-navy/95 backdrop-blur-md sm:hidden">
            <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-5 py-5">
              <Link
                href="/how-it-works"
                className="py-3 text-sm font-medium uppercase tracking-[0.14em] text-white"
              >
                How It Works
              </Link>
              {signedIn ? (
                <AccountMenuMobileLinks onNavigate={() => setOpen(false)} />
              ) : (
                <Link
                  href="/sign-in"
                  className="mt-1 inline-flex w-fit rounded-[4px] border border-white/80 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.14em] text-white"
                >
                  Sign In / Up
                </Link>
              )}
            </nav>
          </div>
        ) : null}
      </header>
    );
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-navy">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:h-[72px] sm:px-8 lg:px-10">
        <Link href="/" className="inline-flex items-center" aria-label="Source Bridge home">
          <SourceBridgeLogo size={30} color="white" withWordmark wordmarkClassName="text-white" />
        </Link>

        <nav className="hidden items-center gap-7 lg:flex">
          {desktopNav.map((item) => {
            const active = pathname.startsWith(item.href);
            const isJoin = item.href === "/join";
            if (isJoin) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex h-10 items-center rounded-[5px] bg-electric px-5 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-electric-hover"
                >
                  {item.label}
                </Link>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`text-xs font-medium uppercase tracking-[0.14em] transition-colors ${
                  active ? "text-white" : "text-white/65 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          {signedIn ? <AccountMenu variant="internal" /> : null}
        </nav>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center text-white lg:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={22} strokeWidth={1.5} /> : <Menu size={22} strokeWidth={1.5} />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-white/10 bg-navy lg:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-5 py-6 sm:px-8">
            {navItems
              .filter((item) => {
                if (!signedIn) return true;
                return item.href !== "/sign-in" && item.href !== "/join";
              })
              .map((item) => {
                const active = pathname.startsWith(item.href);
                const isJoin = item.href === "/join";
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`py-3 text-sm font-medium uppercase tracking-[0.14em] ${
                      isJoin
                        ? "mt-2 inline-flex w-fit rounded-[5px] bg-electric px-5 py-3 text-white"
                        : active
                          ? "text-white"
                          : "text-white/65"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            {signedIn ? (
              <div className="mt-1 flex flex-col gap-1 border-t border-white/10 pt-2">
                <AccountMenuMobileLinks onNavigate={() => setOpen(false)} />
              </div>
            ) : null}
          </nav>
        </div>
      ) : null}
    </header>
  );
}

/** @deprecated Use SiteHeader */
export const Header = SiteHeader;
