"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { useAppUi } from "@/components/providers/AppProviders";

type Row = {
  id: string;
  subject: string;
  contextType: string;
  typeLabel?: string;
  unread: boolean;
  lastMessageAt: string | null;
};

export default function RequestsPage() {
  const { signedIn, authReady } = useAppUi();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authReady || !signedIn) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/conversations?limit=50");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load");
        const list = (data.conversations || []) as Row[];
        if (!cancelled) {
          setRows(
            list.filter((c) =>
              ["sourcing", "listing", "opportunity"].includes(c.contextType),
            ),
          );
        }
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, signedIn]);

  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
      <Container className="max-w-xl">
        <h1 className="font-display text-4xl text-white">Requests</h1>
        <p className="mt-3 text-white/55">
          Sourcing requests and enquiries you send or receive.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button href="/explore">Find members on Explore</Button>
          <Button href="/inbox" variant="outline">
            Open inbox
          </Button>
        </div>
        {!signedIn ? (
          <p className="mt-6 text-sm text-white/45">
            Sign in to create and track requests.
          </p>
        ) : loading ? (
          <p className="mt-10 text-sm text-white/45">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-10 rounded-xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/55">
            No open requests yet. Send a sourcing request from Explore or a
            member profile.
          </p>
        ) : (
          <ul className="mt-10 space-y-2">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/inbox/${row.id}`}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 hover:border-electric/40"
                >
                  <span>
                    <span className="block text-[10px] uppercase tracking-[0.12em] text-electric">
                      {row.typeLabel || row.contextType}
                    </span>
                    <span className="mt-1 block text-sm text-white">
                      {row.subject || "Conversation"}
                    </span>
                  </span>
                  {row.unread ? (
                    <span className="h-2 w-2 rounded-full bg-electric" />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </div>
  );
}
