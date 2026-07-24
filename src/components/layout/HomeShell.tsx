"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Footer } from "@/components/layout/Footer";
import { MobileNav } from "@/components/layout/MobileNav";

export function HomeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <div className={`flex min-h-screen flex-col ${isHome ? "bg-navy" : ""}`}>
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
