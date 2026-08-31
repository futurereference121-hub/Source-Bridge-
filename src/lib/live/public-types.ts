export type LiveBroadcasterPublic = {
  id: string;
  username: string | null;
  slug: string | null;
  name: string;
  photo: string;
};

export type LiveSessionPublic = {
  id: string;
  status: string;
  title: string;
  locationLabel: string;
  startedAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  cooldownUntil: string | null;
  wasLiveUntil: string | null;
  endedReason: string;
  version: number;
  serverNow: string;
  remainingMs: number;
  broadcaster: LiveBroadcasterPublic;
};
