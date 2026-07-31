import { type ReactNode } from "react";
import { AppProviders } from "@/components/providers/AppProviders";
import { HomeShell } from "@/components/layout/HomeShell";
import { NavigationProgress } from "@/components/layout/NavigationProgress";
import { StoryProvider } from "@/components/stories/StoryProvider";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      <StoryProvider>
        <NavigationProgress />
        <HomeShell>{children}</HomeShell>
      </StoryProvider>
    </AppProviders>
  );
}
