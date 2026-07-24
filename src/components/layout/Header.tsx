"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { navItems, siteConfig } from "@/lib/site";
import { useAppUi } from "@/components/providers/AppProviders";

export function Header() {
  const pathname = usePathname();
  const { signedIn, account } = useAppUi();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isHome = pathname === "/";
  const solid = scrolled || !isHome || open;

  const desktopNav = navItems.filter((item) => {
    if (item.href === "/sign-in" && signedIn) return false;
    if (item.href === "/join" && signedIn) return false;
    return true;
  });

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        solid
          ? "border-b border-border/80 bg-background/95 backdrop-blur-md"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:h-20 sm:px-8 lg:px-10">
        <Link
          href="/"
          className={`font-display text-xl tracking-[0.08em] sm:text-2xl ${
            solid || !isHome ? "text-ink" : "text-white"
          }`}
        >
          {siteConfig.name.toUpperCase()}
        </Link>

        <nav className="hidden items-center gap-7 lg:flex">
          {desktopNav.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const isJoin = item.href === "/join";
            if (isJoin) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex h-10 items-center bg-accent px-5 text-xs font-medium uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-hover"
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
                  solid || !isHome
                    ? active
                      ? "text-ink"
                      : "text-muted hover:text-ink"
                    : active
                      ? "text-white"
                      : "text-white/70 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          {signedIn ? (
            <Link
              href="/profile"
              className={`text-xs font-medium uppercase tracking-[0.14em] ${
                solid || !isHome ? "text-ink" : "text-white"
              }`}
            >
              {account?.name?.split(" ")[0] || "Profile"}
            </Link>
          ) : null}
        </nav>

        <button
          type="button"
          className={`inline-flex h-10 w-10 items-center justify-center lg:hidden ${
            solid || !isHome ? "text-ink" : "text-white"
          }`}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={22} strokeWidth={1.5} /> : <Menu size={22} strokeWidth={1.5} />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-border bg-background lg:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-5 py-6 sm:px-8">
            {navItems.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              const isJoin = item.href === "/join";
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`py-3 text-sm font-medium uppercase tracking-[0.14em] ${
                    isJoin
                      ? "mt-2 inline-flex w-fit bg-accent px-5 py-3 text-white"
                      : active
                        ? "text-ink"
                        : "text-muted"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
