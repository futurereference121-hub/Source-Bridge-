"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ImagePlus, Loader2, Send, X } from "lucide-react";
import { useAppUi } from "@/components/providers/AppProviders";
import { uploadProfileImageFile } from "@/lib/client-image-upload";
import { memberPhoto } from "@/lib/placeholders";
import { ReviewPrompt } from "@/components/messaging/ReviewPrompt";

type ParticipantUser = {
  id: string;
  name: string;
  username: string | null;
  slug: string | null;
  photo: string;
};

type Participant = {
  userId: string;
  lastReadAt: string | null;
  leftAt: string | null;
  user?: ParticipantUser;
};

type Attachment = {
  id: string;
  url: string;
  pathname: string;
  mimeType: string;
  sizeBytes: number;
};

type Message = {
  id: string;
  conversationId: string;
  senderId: string | null;
  body: string;
  createdAt: string;
  messageType?: string;
  systemEventType?: string;
  replyAllowed?: boolean;
  attachments: Attachment[];
  sender?: ParticipantUser;
};

type Conversation = {
  id: string;
  subject: string;
  contextType: string;
  typeLabel?: string;
  lastMessageAt: string | null;
  lastMessage: Message | null;
  unread: boolean;
  participants: Participant[];
  sourcingRequest?: {
    id: string;
    message: string;
    neededFrom: string;
    budget: string;
    deadline: string;
    referenceImages: string[];
  } | null;
  listing?: {
    id: string;
    name: string;
    cover: string;
    price: number | null;
    currency: string;
    slug: string;
  } | null;
};

type MessagesInboxProps = {
  initialConversationId?: string | null;
};

function otherParticipant(
  conversation: Conversation,
  myId: string,
): ParticipantUser | null {
  if (conversation.contextType === "system") return null;
  const part = conversation.participants.find((p) => p.userId !== myId);
  return part?.user ?? null;
}

function conversationTitle(
  conversation: Conversation,
  myId: string,
): string {
  if (conversation.contextType === "system") {
    return conversation.subject || "Source Bridge";
  }
  return displayName(otherParticipant(conversation, myId));
}

function displayName(user: ParticipantUser | null, fallback = "Member") {
  if (!user) return fallback;
  if (user.username) return `@${user.username}`;
  return user.name || fallback;
}

function formatTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function previewText(message: Message | null) {
  if (!message) return "No messages yet";
  const body = message.body?.trim();
  if (body) return body;
  if (message.attachments?.length) return "Sent an image";
  return "No messages yet";
}

export function MessagesInbox({
  initialConversationId = null,
}: MessagesInboxProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryId = searchParams.get("c") || initialConversationId;
  const { account, showToast } = useAppUi();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listCursor, setListCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listLoadingMore, setListLoadingMore] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(queryId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [draft, setDraft] = useState("");
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shouldScrollRef = useRef(true);

  const myId = account?.id ?? "";

  const selectConversation = useCallback(
    (id: string | null) => {
      setActiveId(id);
      if (id) router.replace(`/inbox/${id}`, { scroll: false });
      else router.replace("/inbox", { scroll: false });
    },
    [router],
  );

  const loadConversations = useCallback(
    async (opts?: { cursor?: string; append?: boolean }) => {
      if (opts?.append) setListLoadingMore(true);
      else setListLoading(true);
      try {
        const url = new URL("/api/conversations", window.location.origin);
        url.searchParams.set("limit", "30");
        if (opts?.cursor) url.searchParams.set("cursor", opts.cursor);
        const res = await fetch(url.pathname + url.search);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load conversations");
        }
        const data = (await res.json()) as {
          conversations: Conversation[];
          nextCursor: string | null;
        };
        setConversations((prev) =>
          opts?.append
            ? [
                ...prev,
                ...data.conversations.filter(
                  (c) => !prev.some((p) => p.id === c.id),
                ),
              ]
            : data.conversations,
        );
        setListCursor(data.nextCursor);
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : "Failed to load conversations",
        );
      } finally {
        setListLoading(false);
        setListLoadingMore(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    setActiveId(queryId);
  }, [queryId]);

  useEffect(() => {
    if (!activeId || !myId) {
      setMessages([]);
      setActiveConversation(null);
      setMessagesCursor(null);
      return;
    }

    let cancelled = false;
    shouldScrollRef.current = true;

    async function openThread() {
      setThreadLoading(true);
      try {
        // GET conversation marks the thread read on the server
        const res = await fetch(`/api/conversations/${activeId}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Failed to open conversation");
        }
        if (cancelled) return;

        setActiveConversation(data.conversation as Conversation);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeId ? { ...c, unread: false } : c,
          ),
        );

        const page = await fetch(
          `/api/conversations/${activeId}/messages?limit=30`,
        );
        if (!page.ok) {
          // Fall back to messages from conversation payload
          const fallback = (data.messages as Message[]) ?? [];
          setMessages(fallback);
          setMessagesCursor(null);
          return;
        }
        const pageData = (await page.json()) as {
          messages: Message[];
          nextCursor: string | null;
        };
        if (cancelled) return;
        setMessages(pageData.messages ?? []);
        setMessagesCursor(pageData.nextCursor);
      } catch (err) {
        if (!cancelled) {
          showToast(
            err instanceof Error ? err.message : "Failed to open conversation",
          );
          setActiveConversation(null);
          setMessages([]);
          setMessagesCursor(null);
        }
      } finally {
        if (!cancelled) setThreadLoading(false);
      }
    }

    void openThread();
    return () => {
      cancelled = true;
    };
  }, [activeId, myId, showToast]);

  useEffect(() => {
    if (!shouldScrollRef.current) return;
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, threadLoading]);

  async function loadOlderMessages() {
    if (!activeId || !messagesCursor || loadingOlder) return;
    setLoadingOlder(true);
    shouldScrollRef.current = false;
    try {
      const res = await fetch(
        `/api/conversations/${activeId}/messages?limit=30&cursor=${encodeURIComponent(messagesCursor)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load messages");
      const older = (data.messages as Message[]) ?? [];
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        return [...older.filter((m) => !ids.has(m.id)), ...prev];
      });
      setMessagesCursor(data.nextCursor ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load messages");
    } finally {
      setLoadingOlder(false);
    }
  }

  async function onAttach(file: File | undefined) {
    if (!file || !account) return;
    setUploading(true);
    try {
      const result = await uploadProfileImageFile({
        file,
        folder: "misc",
        kind: "stock",
        userId: account.id,
      });
      setPendingUrls((prev) => [...prev, result.url].slice(0, 3));
      URL.revokeObjectURL(result.previewUrl);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function sendMessage() {
    if (!activeId || sending || uploading) return;
    const text = draft.trim();
    if (!text && pendingUrls.length === 0) return;

    const clientMessageId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    setSending(true);
    shouldScrollRef.current = true;
    try {
      const res = await fetch(`/api/conversations/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          attachmentUrls: pendingUrls.slice(0, 3),
          clientMessageId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to send");

      const message = data.message as Message;
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message],
      );
      setDraft("");
      setPendingUrls([]);
      setConversations((prev) => {
        const updated = prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                lastMessage: message,
                lastMessageAt: message.createdAt,
                unread: false,
              }
            : c,
        );
        return [...updated].sort((a, b) => {
          const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
          const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
          return bt - at;
        });
      });
      setActiveConversation((prev) =>
        prev && prev.id === activeId
          ? {
              ...prev,
              lastMessage: message,
              lastMessageAt: message.createdAt,
              unread: false,
            }
          : prev,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage();
  }

  const activeOther = activeConversation
    ? otherParticipant(activeConversation, myId)
    : null;

  return (
    <>
      <ReviewPrompt />
      <div className="panel-navy mt-8 flex min-h-[min(70vh,720px)] flex-col overflow-hidden rounded-xl lg:flex-row">
        {/* Conversation list */}
        <aside className="flex max-h-[40vh] w-full shrink-0 flex-col border-b border-white/10 lg:max-h-none lg:w-[340px] lg:border-b-0 lg:border-r">
          <div className="border-b border-white/10 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
              Inbox
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {listLoading ? (
              <p className="px-4 py-8 text-sm text-white/45">Loading…</p>
            ) : conversations.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-white/70">No conversations yet</p>
                <p className="mt-2 text-xs text-white/40">
                  Message a member from their profile or a listing to start.
                </p>
              </div>
            ) : (
              <ul>
                {conversations.map((c) => {
                  const other = otherParticipant(c, myId);
                  const selected = c.id === activeId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => selectConversation(c.id)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                          selected
                            ? "bg-electric/15"
                            : "hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-navy-mid">
                          <Image
                            src={memberPhoto(other?.photo)}
                            alt=""
                            fill
                            sizes="40px"
                            className="object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`truncate text-sm ${
                                c.unread
                                  ? "font-semibold text-white"
                                  : "text-white/85"
                              }`}
                            >
                              {conversationTitle(c, myId)}
                            </span>
                            {c.unread ? (
                              <span
                                className="h-2 w-2 shrink-0 rounded-full bg-electric"
                                aria-label="Unread"
                              />
                            ) : null}
                            <span className="ml-auto shrink-0 text-[11px] text-white/35">
                              {formatTime(c.lastMessageAt)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-electric/80">
                            {c.typeLabel || c.contextType}
                          </p>
                          <p
                            className={`mt-0.5 truncate text-xs ${
                              c.unread ? "text-white/70" : "text-white/40"
                            }`}
                          >
                            {c.subject?.trim()
                              ? `${c.subject} · `
                              : ""}
                            {previewText(c.lastMessage)}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {listCursor ? (
              <div className="border-t border-white/10 p-3">
                <button
                  type="button"
                  disabled={listLoadingMore}
                  onClick={() =>
                    void loadConversations({
                      cursor: listCursor,
                      append: true,
                    })
                  }
                  className="w-full rounded-lg border border-white/15 py-2 text-xs uppercase tracking-[0.12em] text-white/60 hover:border-electric/40 hover:text-white disabled:opacity-50"
                >
                  {listLoadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        {/* Thread */}
        <section className="flex min-h-[320px] flex-1 flex-col">
          {!activeId ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <p className="text-sm text-white/70">Select a conversation</p>
              <p className="mt-2 max-w-sm text-xs text-white/40">
                Your threads with other members will appear here.
              </p>
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-navy-mid">
                  <Image
                    src={memberPhoto(activeOther?.photo)}
                    alt=""
                    fill
                    sizes="36px"
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {activeConversation && account
                      ? conversationTitle(activeConversation, account.id)
                      : displayName(activeOther)}
                  </p>
                  {activeConversation?.contextType === "system" ? (
                    <p className="truncate text-xs uppercase tracking-[0.12em] text-electric">
                      Official notification
                    </p>
                  ) : activeConversation?.subject?.trim() ? (
                    <p className="truncate text-xs text-white/40">
                      {activeConversation.subject}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="ml-auto text-xs text-white/40 hover:text-white lg:hidden"
                  onClick={() => selectConversation(null)}
                >
                  Back
                </button>
              </header>

              <div className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
                {messagesCursor ? (
                  <button
                    type="button"
                    disabled={loadingOlder}
                    onClick={() => void loadOlderMessages()}
                    className="mb-4 self-center text-xs text-electric hover:text-electric-hover disabled:opacity-50"
                  >
                    {loadingOlder ? "Loading…" : "Load earlier messages"}
                  </button>
                ) : null}

                {threadLoading ? (
                  <p className="py-10 text-center text-sm text-white/45">
                    Loading thread…
                  </p>
                ) : messages.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
                    <p className="text-sm text-white/70">No messages yet</p>
                    <p className="mt-2 text-xs text-white/40">
                      Say hello to start the conversation.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {activeConversation?.sourcingRequest ? (
                      <li className="rounded-xl border border-electric/30 bg-electric/10 px-4 py-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-electric">
                          Sourcing request
                        </p>
                        {activeConversation.listing ? (
                          <p className="mt-2 text-xs text-white/60">
                            Listing: {activeConversation.listing.name}
                          </p>
                        ) : null}
                        <dl className="mt-3 space-y-2 text-sm">
                          <div>
                            <dt className="text-[10px] uppercase tracking-[0.12em] text-white/40">
                              Looking for
                            </dt>
                            <dd className="mt-1 whitespace-pre-wrap text-white/85">
                              {activeConversation.sourcingRequest.message}
                            </dd>
                          </div>
                          {activeConversation.sourcingRequest.neededFrom ? (
                            <div>
                              <dt className="text-[10px] uppercase tracking-[0.12em] text-white/40">
                                Needed from
                              </dt>
                              <dd className="mt-1 text-white/80">
                                {activeConversation.sourcingRequest.neededFrom}
                              </dd>
                            </div>
                          ) : null}
                          {activeConversation.sourcingRequest.budget ? (
                            <div>
                              <dt className="text-[10px] uppercase tracking-[0.12em] text-white/40">
                                Budget
                              </dt>
                              <dd className="mt-1 text-white/80">
                                {activeConversation.sourcingRequest.budget}
                              </dd>
                            </div>
                          ) : null}
                          {activeConversation.sourcingRequest.deadline ? (
                            <div>
                              <dt className="text-[10px] uppercase tracking-[0.12em] text-white/40">
                                Deadline
                              </dt>
                              <dd className="mt-1 text-white/80">
                                {activeConversation.sourcingRequest.deadline}
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                        {activeConversation.sourcingRequest.referenceImages
                          ?.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {activeConversation.sourcingRequest.referenceImages.map(
                              (url) => (
                                <a
                                  key={url}
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="relative h-16 w-16 overflow-hidden rounded-lg border border-white/15"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={url}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                </a>
                              ),
                            )}
                          </div>
                        ) : null}
                      </li>
                    ) : null}
                    {messages.map((m) => {
                      const isSystem = m.messageType === "SYSTEM" || !m.senderId;
                      const mine = !isSystem && m.senderId === myId;
                      return (
                        <li
                          key={m.id}
                          className={`flex ${mine ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[85%] rounded-xl px-3.5 py-2.5 sm:max-w-[70%] ${
                              isSystem
                                ? "w-full border border-electric/25 bg-electric/10 text-white/90"
                                : mine
                                  ? "bg-electric/25 text-white"
                                  : "bg-white/[0.06] text-white/90"
                            }`}
                          >
                            {isSystem ? (
                              <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-electric">
                                Source Bridge official
                              </p>
                            ) : !mine ? (
                              <p className="mb-1 text-[11px] text-white/45">
                                {displayName(m.sender ?? null)}
                              </p>
                            ) : null}
                            {m.body?.trim() ? (
                              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                                {m.body}
                              </p>
                            ) : null}
                            {m.attachments?.length ? (
                              <div
                                className={`mt-2 grid gap-2 ${
                                  m.attachments.length > 1
                                    ? "grid-cols-2"
                                    : "grid-cols-1"
                                }`}
                              >
                                {m.attachments.map((a) => (
                                  <a
                                    key={a.id}
                                    href={a.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="relative block aspect-square overflow-hidden rounded-lg bg-black/30"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={a.url}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  </a>
                                ))}
                              </div>
                            ) : null}
                            <p
                              className={`mt-1.5 text-[10px] ${
                                mine ? "text-white/50" : "text-white/35"
                              }`}
                            >
                              {formatTime(m.createdAt)}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div ref={threadEndRef} />
              </div>

              {activeConversation?.contextType === "system" ||
              messages.some((m) => m.replyAllowed === false) ? (
                <div className="border-t border-white/10 px-4 py-4 text-sm text-white/50">
                  This is an official Source Bridge notification. Replies are
                  disabled.
                </div>
              ) : (
              <form
                onSubmit={onSubmit}
                className="border-t border-white/10 px-3 py-3 sm:px-4"
              >
                {pendingUrls.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {pendingUrls.map((url) => (
                      <div
                        key={url}
                        className="relative h-14 w-14 overflow-hidden rounded-lg border border-white/15"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setPendingUrls((prev) =>
                              prev.filter((u) => u !== url),
                            )
                          }
                          className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white"
                          aria-label="Remove attachment"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex items-end gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => void onAttach(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    disabled={uploading || pendingUrls.length >= 5}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/15 text-white/60 hover:border-electric/40 hover:text-electric disabled:opacity-40"
                    aria-label="Attach image"
                  >
                    {uploading ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <ImagePlus size={18} />
                    )}
                  </button>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onComposerKey}
                    rows={1}
                    placeholder="Write a message…"
                    className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-lg border border-white/15 bg-[#061228] px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-electric/50 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={
                      sending ||
                      uploading ||
                      (!draft.trim() && pendingUrls.length === 0)
                    }
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-electric text-white hover:bg-electric-hover disabled:opacity-40"
                    aria-label="Send"
                  >
                    {sending ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <Send size={18} />
                    )}
                  </button>
                </div>
              </form>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
