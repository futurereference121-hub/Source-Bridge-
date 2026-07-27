"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Footer } from "@/components/layout/Footer";
import { MobileNav } from "@/components/layout/MobileNav";

export function HomeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isAppNavy =
    pathname.startsWith("/explore") ||
    pathname.startsWith("/members") ||
    pathname.startsWith("/profile") ||
    pathname.startsWith("/check-email") ||
    pathname.startsWith("/verify-email") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/activity") ||
    pathname.startsWith("/join") ||
    pathname.startsWith("/sign-in");

  return (
    <div
      className={`flex min-h-screen flex-col ${
        isHome || isAppNavy ? "bg-navy" : ""
      }`}
    >
      <SiteHeader />
      <main className={`flex-1 ${isHome ? "" : "pb-16 md:pb-0"}`}>{children}</main>
      {isHome ? null : (
        <>
          <Footer />
          <MobileNav />
        </>
      )}
    </div>
  );
}
