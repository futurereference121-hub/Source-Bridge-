"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { uploadProfileImageFile } from "@/lib/client-image-upload";
import { IMAGE_ACCEPT_ATTR } from "@/lib/storage-constants";
import DisputeContextMessage from "@/components/messaging/DisputeContextMessage";

type Attachment = {
  id?: string;
  url: string;
};

type Message = {
  id: string;
  senderId: string | null;
  body: string;
  createdAt: string;
  messageType?: string;
  systemEventType?: string;
  paymentTicketId?: string | null;
  sender: { id: string; name: string; username: string | null } | null;
  attachments?: Attachment[];
};

type Thread = {
  id: string;
  adminPartyRole: string | null;
  subject: string;
  disputeCaseId?: string | null;
  paymentTicketId?: string | null;
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
  const [thread, setThread] = useState<Thread | null>(initialThread ?? null);
  const [draft, setDraft] = useState("");
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activityAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialThread) return;
    const latest = initialThread.messages.at(-1)?.createdAt ?? null;
    if (latest) activityAtRef.current = latest;
    setThread((prev) => {
      if (!prev) return initialThread;
      const known = new Set(prev.messages.map((m) => m.id));
      const extra = initialThread.messages.filter((m) => !known.has(m.id));
      if (!extra.length && prev.id === initialThread.id) {
        if (prev.messages.length === initialThread.messages.length) return prev;
      }
      return {
        ...initialThread,
        messages: mergeChronological(prev.messages, initialThread.messages),
      };
    });
  }, [initialThread]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      try {
        const url = new URL("/api/admin/payments/issues/threads", window.location.origin);
        url.searchParams.set("disputeId", disputeId);
        if (activityAtRef.current) {
          url.searchParams.set("since", activityAtRef.current);
        }
        const res = await fetch(url.pathname + url.search, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          unchanged?: boolean;
          activityAt?: string;
          threads?: Thread[];
        };
        if (data.activityAt) {
          activityAtRef.current = data.activityAt;
        }
        if (data.unchanged) return;
        const next = (data.threads || []).find(
          (t) => t.adminPartyRole === role,
        );
        if (next) setThread(next);
      } catch {
        /* keep local history */
      }
    }
    const id = window.setInterval(() => void refresh(), 5_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener("online", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener("online", onVis);
    };
  }, [disputeId, role]);

  async function send() {
    const body = draft.trim();
    if ((!body && pendingUrls.length === 0) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payments/issues/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disputeId,
          role,
          body: body || (pendingUrls.length ? "Sent a photo" : ""),
          attachmentUrls: pendingUrls,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        conversationId?: string;
        message?: Message;
      };
      if (!res.ok) {
        setError(data.error || `Failed (${res.status})`);
        return;
      }
      if (data.message) {
        setThread((prev) => {
          const base: Thread =
            prev ?? {
              id: data.conversationId || "",
              adminPartyRole: role,
              subject: label,
              messages: [],
            };
          if (base.messages.some((m) => m.id === data.message!.id)) return base;
          return {
            ...base,
            id: data.conversationId || base.id,
            messages: [...base.messages, data.message!],
          };
        });
        activityAtRef.current = data.message.createdAt;
      }
      setDraft("");
      setPendingUrls([]);
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
        setThread(
          (prev) =>
            prev ?? {
              id: data.conversationId!,
              adminPartyRole: role,
              subject: label,
              messages: [],
            },
        );
      }
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
        Private two-way thread — same messages as Inbox. The other party cannot
        see this side.
      </p>
      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {(thread?.messages || []).length === 0 ? (
          <p className="text-xs text-white/35">No messages yet.</p>
        ) : (
          thread!.messages.map((m) => {
            const mine = m.senderId === adminUserId;
            const isDisputeContext =
              m.systemEventType === "DISPUTE_CONTEXT" ||
              /\b(?:dispute|txn|ticket)\s+[a-z0-9_-]{8,}/i.test(m.body || "");
            return (
              <div
                key={m.id}
                className={`rounded-lg px-3 py-2 text-xs ${
                  isDisputeContext
                    ? "border border-electric/20 bg-electric/10 text-white/90"
                    : mine
                      ? "ml-6 bg-electric/15 text-white"
                      : "mr-6 bg-white/5 text-white/80"
                }`}
              >
                {isDisputeContext ? (
                  <DisputeContextMessage
                    body={m.body || ""}
                    createdAt={m.createdAt}
                    structured={{
                      disputeCaseId: disputeId,
                      paymentTicketId:
                        m.paymentTicketId || thread?.paymentTicketId || null,
                      reviewHref: `/admin/reviews/${disputeId}`,
                    }}
                  />
                ) : (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-white/40">
                      {mine
                        ? "Source Bridge"
                        : m.sender?.username
                          ? `@${m.sender.username}`
                          : m.sender?.name || "Party"}
                    </p>
                    {m.body ? (
                      <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                    ) : null}
                  </>
                )}
                {(m.attachments || []).map((a) => (
                  <a
                    key={a.url}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block overflow-hidden rounded-md border border-white/10"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.url} alt="" className="max-h-40 w-full object-cover" />
                  </a>
                ))}
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
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/15 px-2 py-1.5 text-[11px] text-white/70">
              <ImagePlus size={14} />
              {uploading ? "Uploading…" : "Attach photo"}
              <input
                type="file"
                accept={IMAGE_ACCEPT_ATTR}
                className="sr-only"
                disabled={busy || uploading || pendingUrls.length >= 3}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setUploading(true);
                  try {
                    const result = await uploadProfileImageFile({
                      file,
                      folder: "misc",
                      kind: "stock",
                      userId: adminUserId,
                    });
                    setPendingUrls((prev) => [...prev, result.url].slice(0, 3));
                    URL.revokeObjectURL(result.previewUrl);
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "Upload failed",
                    );
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </label>
            {pendingUrls.length ? (
              <span className="text-[11px] text-white/45">
                {pendingUrls.length} photo{pendingUrls.length === 1 ? "" : "s"}
              </span>
            ) : null}
            <button
              type="button"
              disabled={busy || uploading || (!draft.trim() && !pendingUrls.length)}
              onClick={() => void send()}
              className="ml-auto rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      )}
      {error ? <p className="mt-2 text-xs text-amber-200/90">{error}</p> : null}
    </div>
  );
}

function mergeChronological(a: Message[], b: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of [...a, ...b]) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => {
    const xt = Date.parse(x.createdAt);
    const yt = Date.parse(y.createdAt);
    if (xt !== yt) return xt - yt;
    return x.id < y.id ? -1 : 1;
  });
}
