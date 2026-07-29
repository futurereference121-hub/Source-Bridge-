"use client";

import { useEffect } from "react";
import { useAppUi } from "@/components/providers/AppProviders";
import { subscribeToNewNotifications, useNotifications } from "@/hooks/useNotifications";
import {
  configureNotificationSounds,
  playNotificationSound,
  registerNotificationAudioUnlock,
  soundKindForNotificationType,
} from "@/lib/notification-sounds";

/**
 * Invisible global mount: keeps the shared notification poll alive, keeps the
 * sound player in sync with the signed-in user's preferences, and plays a
 * sound whenever a genuinely new notification arrives (never on refresh).
 */
export function NotificationListener() {
  const { account, signedIn, refreshAccount } = useAppUi();
  useNotifications();

  useEffect(() => {
    configureNotificationSounds({
      enabled: account?.notificationSoundsEnabled ?? true,
      volume: (account?.notificationVolume as "low" | "medium" | "high") ?? "medium",
    });
  }, [account?.notificationSoundsEnabled, account?.notificationVolume]);

  useEffect(() => {
    if (!signedIn) return;
    return registerNotificationAudioUnlock();
  }, [signedIn]);

  useEffect(
    () =>
      subscribeToNewNotifications((items) => {
        let shouldRefreshAccount = false;
        for (const item of items) {
          const kind = soundKindForNotificationType(item.type);
          if (kind) playNotificationSound(kind);
          // Verification approve/reject updates identityVerified — refresh session.
          if (
            item.type === "SYSTEM" &&
            /verif/i.test(`${item.title} ${item.body} ${item.href}`)
          ) {
            shouldRefreshAccount = true;
          }
        }
        if (shouldRefreshAccount) void refreshAccount();
      }),
    [refreshAccount],
  );

  return null;
}
