import { type ReactNode } from "react";
import { AppProviders } from "@/components/providers/AppProviders";
import { HomeShell } from "@/components/layout/HomeShell";
import { NavigationProgress } from "@/components/layout/NavigationProgress";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      <NavigationProgress />
      <HomeShell>{children}</HomeShell>
    </AppProviders>
  );
}
