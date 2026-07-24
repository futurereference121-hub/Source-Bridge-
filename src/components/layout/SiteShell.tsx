import { type ReactNode } from "react";
import { AppProviders } from "@/components/providers/AppProviders";
import { HomeShell } from "@/components/layout/HomeShell";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      <HomeShell>{children}</HomeShell>
    </AppProviders>
  );
}
