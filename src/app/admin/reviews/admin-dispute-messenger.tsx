"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Message = {
  id: string;
  senderId: string | null;
  body: string;
  createdAt: string;
  sender: { id: string; name: string; username: string | null } | null;
};

type Thread = {
  id: string;
  adminPartyRole: string | null;
  subject: string;
  messages: Message[];
};

type Props = {
  disputeId: string;
  role: "BUYER" | "SELLER";
  label: string;
  adminUserId: string;
  initialThread?: Thread | null;
};

export default function AdminDisputeMessenger({
  disputeId,
  role,
  label,
  adminUserId,
  initialThread,
}: Props) {
  const router = useRouter();
  const [thread, setThread] = useState<Thread | null>(initialThread ?? null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payments/issues/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disputeId, role, body }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        conversationId?: string;
      };
      if (!res.ok) {
        setError(data.error || `Failed (${res.status})`);
        return;
      }
      setDraft("");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function ensureThread() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payments/issues/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disputeId, role }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        conversationId?: string;
      };
      if (!res.ok) {
        setError(data.error || `Failed (${res.status})`);
        return;
      }
      if (data.conversationId) {
        setThread((prev) => prev ?? { id: data.conversationId!, adminPartyRole: role, subject: label, messages: [] });
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[16rem] flex-col rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-electric">
          {label}
        </p>
        {thread?.id ? (
          <a
            href={`/inbox/${thread.id}`}
            className="text-[10px] uppercase tracking-[0.12em] text-white/45 hover:text-electric"
          >
            Open inbox
          </a>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] text-white/40">
        Private thread — not the Buyer↔Sourcer conversation.
      </p>
      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {(thread?.messages || []).length === 0 ? (
          <p className="text-xs text-white/35">No messages yet.</p>
        ) : (
          thread!.messages.map((m) => {
            const mine = m.senderId === adminUserId;
            return (
              <div
                key={m.id}
                className={`rounded-lg px-3 py-2 text-xs ${
                  mine
                    ? "ml-6 bg-electric/15 text-white"
                    : "mr-6 bg-white/5 text-white/80"
                }`}
              >
                <p className="text-[10px] uppercase tracking-wide text-white/40">
                  {mine
                    ? "Source Bridge"
                    : m.sender?.username
                      ? `@${m.sender.username}`
                      : m.sender?.name || "Party"}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
              </div>
            );
          })
        )}
      </div>
      {!thread ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void ensureThread()}
          className="mt-3 rounded-lg border border-white/20 px-3 py-2 text-xs text-white disabled:opacity-50"
        >
          {busy ? "Opening…" : `Start private thread`}
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={4000}
            disabled={busy}
            className="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
            placeholder={`Message ${role === "BUYER" ? "buyer" : "sourcer"}…`}
          />
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void send()}
            className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      )}
      {error ? <p className="mt-2 text-xs text-amber-200/90">{error}</p> : null}
    </div>
  );
}
