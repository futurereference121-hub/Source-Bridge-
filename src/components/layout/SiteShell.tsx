import { type ReactNode } from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileNav } from "@/components/layout/MobileNav";
import { AppProviders } from "@/components/providers/AppProviders";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1 pb-16 md:pb-0">{children}</main>
        <Footer />
        <MobileNav />
      </div>
    </AppProviders>
  );
}
