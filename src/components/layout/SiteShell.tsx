import { type ReactNode } from "react";
import { AppProviders } from "@/components/providers/AppProviders";
import { HomeShell } from "@/components/layout/HomeShell";
import { NavigationProgress } from "@/components/layout/NavigationProgress";
import { StoryProvider } from "@/components/stories/StoryProvider";
import { LivePresenceProvider } from "@/components/live/LivePresenceProvider";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      <StoryProvider>
        <LivePresenceProvider>
          <NavigationProgress />
          <HomeShell>{children}</HomeShell>
        </LivePresenceProvider>
      </StoryProvider>
    </AppProviders>
  );
}
