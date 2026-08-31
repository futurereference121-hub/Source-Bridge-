"use client";

import { useEffect, useState } from "react";
import { LiveBadge } from "@/components/live/LiveBadge";
import type { LiveSessionPublic } from "@/lib/live/public-types";

type AdminRow = LiveSessionPublic & { openReports?: number };

export default function AdminLivePage() {
  const [sessions, setSessions] = useState<AdminRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/live/sessions", { cache: "no-store" });
    if (!res.ok) {
      setSessions([]);
      return;
    }
    const data = (await res.json()) as { sessions?: AdminRow[] };
    setSessions(data.sessions || []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function terminate(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/admin/live/sessions/${id}/terminate`, { method: "POST" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="font-display text-3xl">Live</h1>
      <p className="mt-2 text-sm text-white/55">
        Terminate removes WAS LIVE. Recording is cleaned up — no replay.
      </p>
      <ul className="mt-8 space-y-3">
        {sessions === null ? (
          <li className="text-sm text-white/45">Loading…</li>
        ) : sessions.length === 0 ? (
          <li className="text-sm text-white/45">No active Live sessions.</li>
        ) : (
          sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-white/10 px-4 py-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <LiveBadge
                    label={
                      s.status === "LIVE"
                        ? "LIVE"
                        : s.status === "TERMINATED"
                          ? "Terminated"
                          : s.status
                    }
                  />
                  <span className="text-sm">@{s.broadcaster.username}</span>
                </div>
                <p className="mt-1 text-sm text-white/70">{s.title}</p>
                <p className="text-xs text-white/40">{s.locationLabel}</p>
                {s.openReports ? (
                  <p className="mt-1 text-xs text-amber-300">
                    {s.openReports} open report{s.openReports === 1 ? "" : "s"}
                  </p>
                ) : null}
              </div>
              {s.status === "LIVE" || s.status === "PREPARING" ? (
                <button
                  type="button"
                  disabled={busyId === s.id}
                  onClick={() => void terminate(s.id)}
                  className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-40"
                >
                  End Live
                </button>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
