"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAppUi } from "@/components/providers/AppProviders";
import { LivePlayer } from "@/components/live/LivePlayer";
import { LiveBadge } from "@/components/live/LiveBadge";
import type { LiveSessionPublic } from "@/lib/live/public-types";

export function LiveWatchClient({ sessionId }: { sessionId: string }) {
  const { signedIn, authReady, account } = useAppUi();
  const [session, setSession] = useState<LiveSessionPublic | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/live/sessions/${sessionId}`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json()) as {
          session?: LiveSessionPublic;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Live not found");
        if (!cancelled) setSession(data.session || null);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    const poll = window.setInterval(() => {
      void fetch(`/api/live/sessions/${sessionId}`, { cache: "no-store" })
        .then(async (res) => {
          const data = (await res.json()) as { session?: LiveSessionPublic };
          if (!cancelled && data.session) setSession(data.session);
        })
        .catch(() => {});
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [sessionId]);

  if (error) {
    return <p className="text-sm text-white/60">{error}</p>;
  }
  if (!session) {
    return <p className="text-sm text-white/50">Loading Live…</p>;
  }

  const next = `/live/${session.id}`;
  const isBroadcaster = Boolean(account && account.id === session.broadcaster.id);

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {session.status === "LIVE" ? <LiveBadge /> : <LiveBadge label="Was Live" />}
            <Link
              href={
                session.broadcaster.slug
                  ? `/members/${session.broadcaster.slug}`
                  : "/explore"
              }
              className="text-sm font-medium text-white"
            >
              @{session.broadcaster.username}
            </Link>
          </div>
          <p className="mt-1 text-xs text-white/50">{session.locationLabel}</p>
        </div>
      </div>

      {session.status === "LIVE" && authReady && !signedIn ? (
        <div className="rounded-2xl border border-white/10 bg-navy-mid p-6 text-center">
          <p className="text-sm text-white/70">
            Sign in to watch this Live. Title and location stay public.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Link
              href={`/sign-in?next=${encodeURIComponent(next)}`}
              className="rounded-lg bg-electric px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white"
            >
              Sign in
            </Link>
            <Link
              href={`/join?next=${encodeURIComponent(next)}`}
              className="rounded-lg border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white"
            >
              Create account
            </Link>
          </div>
        </div>
      ) : session.status === "LIVE" && signedIn ? (
        <LivePlayer session={session} isBroadcaster={isBroadcaster} />
      ) : (
        <div className="flex aspect-[9/16] items-center justify-center rounded-2xl bg-navy-mid text-center">
          <div>
            <LiveBadge label="Was Live" />
            <p className="mt-3 text-sm text-white/65">Replay is not available.</p>
          </div>
        </div>
      )}
    </div>
  );
}
