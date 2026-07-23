import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { type ReactNode } from "react";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
