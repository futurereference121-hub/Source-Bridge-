"use client";

import Image from "next/image";
import Link from "next/link";
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
import { PaymentTicketCard, type PaymentTicketView } from "@/components/messaging/PaymentTicketCard";
import {
  ProposePaymentTicketButton,
  type PaymentsProposalAccess,
} from "@/components/messaging/ProposePaymentTicketButton";
import {
  isActiveLifecycleTicket,
  MAX_ACTIVE_PAYMENT_TICKETS,
  ticketAppearsInChatTimeline,
} from "@/lib/payments/ticket-lifecycle";
import { StoryAvatar } from "@/components/stories/StoryAvatar";
import { useStoriesOptional } from "@/components/stories/StoryProvider";

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
  paymentTicketId?: string | null;
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
  conversation: Conversation | null | undefined,
  myId: string,
): ParticipantUser | null {
  if (!conversation) return null;
  if (conversation.contextType === "system") return null;
  const part = conversation.participants?.find((p) => p.userId !== myId);
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
  if (message.messageType === "SOURCING_REQUEST") {
    const firstLine =
      message.body?.trim().split("\n").find((line) => line.trim()) || "";
    const snippet = firstLine.slice(0, 72);
    return snippet
      ? `Sourcing request: ${snippet}${firstLine.length > 72 ? "…" : ""}`
      : "Sourcing request";
  }
  if (message.messageType === "PAYMENT_TICKET") {
    return "Payment Ticket";
  }
  if (message.messageType === "SYSTEM") {
    const body = message.body?.trim();
    return body ? body.slice(0, 90) : "Official notification";
  }
  const body = message.body?.trim();
  if (body) return body;
  if (message.attachments?.length) return "Sent an image";
  return "No messages yet";
}

/** Client defense: inject missing ticket markers into timeline (dedupe by ticket id). */
type TimelineTicketLite = {
  id: string;
  createdById?: string;
  createdAt: string;
  revision?: number;
  status?: string;
  title?: string;
  lifecycleStage?: string;
  protectedTxnStatus?: string | null;
  buyerId?: string;
  sellerId?: string;
  buyerApprovedRevision?: number | null;
  sellerApprovedRevision?: number | null;
  protectedTransactionId?: string | null;
};

function visibleChatTickets(
  tickets: TimelineTicketLite[] | null | undefined,
): TimelineTicketLite[] {
  if (!tickets?.length) return [];
  return tickets.filter((t) =>
    ticketAppearsInChatTimeline({
      ticketStatus: t.status || "PROPOSED",
      protectedStatus: t.protectedTxnStatus ?? null,
    }),
  );
}

function countActiveTicketsClient(
  tickets: TimelineTicketLite[] | null | undefined,
): number {
  if (!tickets?.length) return 0;
  let n = 0;
  for (const t of tickets) {
    if (
      isActiveLifecycleTicket({
        ticketStatus: t.status || "PROPOSED",
        protectedStatus: t.protectedTxnStatus ?? null,
        lifecycleStage: t.lifecycleStage ?? null,
      })
    ) {
      n += 1;
    }
  }
  return n;
}

function mergePaymentTicketsClient(
  conversationId: string,
  messages: Message[],
  tickets: TimelineTicketLite[] | null | undefined,
): Message[] {
  const visible = visibleChatTickets(tickets);
  const visibleIds = new Set(visible.map((t) => t.id));
  const base = tickets
    ? messages.filter(
        (m) => !m.paymentTicketId || visibleIds.has(m.paymentTicketId),
      )
    : messages.slice();
  if (!visible.length) {
    return base.sort((a, b) => {
      const at = Date.parse(a.createdAt);
      const bt = Date.parse(b.createdAt);
      if (at !== bt) return at - bt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  const covered = new Set(
    base
      .map((m) => m.paymentTicketId)
      .filter((id): id is string => Boolean(id)),
  );
  const injected: Message[] = [];
  for (const t of visible) {
    if (!t?.id || covered.has(t.id)) continue;
    injected.push({
      id: `payment-ticket:${t.id}`,
      conversationId,
      senderId: t.createdById ?? null,
      body:
        t.revision != null && t.title
          ? `Payment Ticket v${t.revision} · ${t.title} (${t.status ?? "PROPOSED"})`
          : "Payment Ticket",
      createdAt: t.createdAt,
      messageType: "PAYMENT_TICKET",
      systemEventType: "PAYMENT_TICKET_PROPOSED",
      replyAllowed: true,
      paymentTicketId: t.id,
      attachments: [],
    });
  }
  return [...base, ...injected].sort((a, b) => {
    const at = Date.parse(a.createdAt);
    const bt = Date.parse(b.createdAt);
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function MessagesInbox({
  initialConversationId = null,
}: MessagesInboxProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryId = searchParams.get("c") || initialConversationId;
  const { account, showToast } = useAppUi();
  const stories = useStoriesOptional();

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

  const [draftByConversation, setDraftByConversation] = useState<
    Record<string, string>
  >({});
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [proposalAccess, setProposalAccess] =
    useState<PaymentsProposalAccess | null>(null);
  const [activeTicketCount, setActiveTicketCount] = useState(0);
  const [paymentTickets, setPaymentTickets] = useState<TimelineTicketLite[]>(
    [],
  );
  const [ticketExpanded, setTicketExpanded] = useState<Record<string, boolean>>(
    {},
  );
  const [threadViewerUserId, setThreadViewerUserId] = useState<string | null>(
    null,
  );
  const [threadViewerUsername, setThreadViewerUsername] = useState<
    string | null
  >(null);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shouldScrollRef = useRef(true);
  const nearBottomRef = useRef(true);
  const softPollInFlightRef = useRef(false);
  const [newMessageHint, setNewMessageHint] = useState(false);

  const myId = account?.id ?? "";
  const ticketViewerId = threadViewerUserId || myId;
  const ticketViewerUsername = threadViewerUsername || account?.username || null;
  const draft = activeId ? draftByConversation[activeId] ?? "" : "";

  function setDraft(value: string) {
    if (!activeId) return;
    setDraftByConversation((prev) => ({ ...prev, [activeId]: value }));
  }

  const selectConversation = useCallback(
    (id: string | null) => {
      setPendingUrls([]);
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
    const ids = conversations
      .map((c) => otherParticipant(c, myId)?.id)
      .filter((id): id is string => Boolean(id));
    if (ids.length) void stories?.refreshRings(ids);
  }, [conversations, myId, stories?.refreshRings]);

  useEffect(() => {
    setActiveId(queryId);
  }, [queryId]);

  useEffect(() => {
    if (!activeId || !myId) {
      setMessages([]);
      setActiveConversation(null);
      setMessagesCursor(null);
      setProposalAccess(null);
      setActiveTicketCount(0);
      setPaymentTickets([]);
      setThreadViewerUserId(null);
      setThreadViewerUsername(null);
      return;
    }

    let cancelled = false;
    shouldScrollRef.current = true;

    async function openThread() {
      setThreadLoading(true);
      setMessages([]);
      setProposalAccess(null);
      setActiveTicketCount(0);
      setPaymentTickets([]);
      try {
        // Single request — conversation GET already returns recent messages.
        const res = await fetch(`/api/conversations/${activeId}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Failed to open conversation");
        }
        if (cancelled) return;

        setThreadViewerUserId(data.viewerUserId || myId);
        setThreadViewerUsername(
          data.viewerUsername || account?.username || null,
        );
        setActiveConversation(data.conversation as Conversation);
        setProposalAccess(
          (data.paymentsProposalAccess as PaymentsProposalAccess | undefined) ??
            null,
        );
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeId ? { ...c, unread: false } : c,
          ),
        );

        const rawMsgs = (data.messages as Message[]) ?? [];
        const tickets = (data.paymentTickets as TimelineTicketLite[] | undefined) ?? [];
        setPaymentTickets(visibleChatTickets(tickets));
        // Server already merges; client re-merge is defense in depth.
        const msgs = mergePaymentTicketsClient(
          activeId!,
          rawMsgs,
          tickets,
        );
        setMessages(msgs);
        setMessagesCursor(msgs.length >= 30 ? msgs[0]?.id ?? null : null);
        const serverCount =
          typeof data.activePaymentTicketCount === "number"
            ? data.activePaymentTicketCount
            : countActiveTicketsClient(tickets);
        setActiveTicketCount(serverCount);
      } catch (err) {
        if (!cancelled) {
          showToast(
            err instanceof Error ? err.message : "Failed to open conversation",
          );
          setActiveConversation(null);
          setMessages([]);
          setMessagesCursor(null);
          setActiveTicketCount(0);
          setPaymentTickets([]);
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
    if (threadLoading) return;
    const container = threadScrollRef.current;
    if (!container) return;
    // Scroll only the message pane — never the browser window.
    container.scrollTop = container.scrollHeight;
    nearBottomRef.current = true;
  }, [messages, threadLoading]);

  // Soft revalidate open conversation (messages + tickets) without wiping UI state.
  useEffect(() => {
    if (!activeId || !myId) return;
    const POLL_MS = 2500;
    let cancelled = false;

    async function softRefresh() {
      if (cancelled || softPollInFlightRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      softPollInFlightRef.current = true;
      try {
        const res = await fetch(`/api/conversations/${activeId}?poll=1`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (cancelled || !data?.conversation) return;

        setThreadViewerUserId(data.viewerUserId || myId);
        setThreadViewerUsername(
          data.viewerUsername || account?.username || null,
        );
        setActiveConversation(data.conversation as Conversation);
        setProposalAccess(
          (data.paymentsProposalAccess as PaymentsProposalAccess | undefined) ??
            null,
        );
        if (typeof data.activePaymentTicketCount === "number") {
          setActiveTicketCount(data.activePaymentTicketCount);
        }

        const rawMsgs = (data.messages as Message[]) ?? [];
        const tickets =
          (data.paymentTickets as TimelineTicketLite[] | undefined) ?? [];
        setPaymentTickets(visibleChatTickets(tickets));
        const merged = mergePaymentTicketsClient(activeId!, rawMsgs, tickets);

        setMessages((prev) => {
          // keep full merge by sorted unique ids from server + any optimistic pending.
          const serverIds = new Set(merged.map((m) => m.id));
          const optimistic = prev.filter(
            (m) =>
              !serverIds.has(m.id) &&
              m.id.startsWith("tmp-") &&
              m.conversationId === activeId,
          );
          const next = [...merged];
          for (const o of optimistic) {
            if (!next.some((m) => m.id === o.id)) next.push(o);
          }
          next.sort((a, b) => {
            const at = Date.parse(a.createdAt);
            const bt = Date.parse(b.createdAt);
            if (at !== bt) return at - bt;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
          });
          // Avoid re-render if same id set and order
          if (
            next.length === prev.length &&
            next.every((m, i) => m.id === prev[i]?.id)
          ) {
            return prev;
          }
          if (!nearBottomRef.current) {
            const prevLast = prev[prev.length - 1]?.id;
            const nextLast = next[next.length - 1]?.id;
            if (nextLast && nextLast !== prevLast) setNewMessageHint(true);
          } else {
            shouldScrollRef.current = true;
            setNewMessageHint(false);
          }
          return next;
        });

        setConversations((prev) => {
          const updated = prev.map((c) =>
            c.id === activeId
              ? {
                  ...c,
                  unread: false,
                  lastMessageAt:
                    (data.conversation as Conversation).lastMessageAt ??
                    c.lastMessageAt,
                  lastMessage:
                    (data.messages as Message[])?.slice(-1)[0] ?? c.lastMessage,
                }
              : c,
          );
          return updated;
        });
      } catch {
        /* silent — avoid toast spam */
      } finally {
        softPollInFlightRef.current = false;
      }
    }

    const id = window.setInterval(() => void softRefresh(), POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void softRefresh();
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
  }, [activeId, myId]);

  function onThreadScroll() {
    const container = threadScrollRef.current;
    if (!container) return;
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    nearBottomRef.current = distance < 80;
    if (nearBottomRef.current) setNewMessageHint(false);
  }

  /** Ticket lifecycle actions must not treat the thread as a new-message jump. */
  async function refreshConversationPreservingViewport() {
    if (!activeId) return;
    const container = threadScrollRef.current;
    const savedTop = container?.scrollTop ?? 0;
    shouldScrollRef.current = false;
    try {
      const res = await fetch(`/api/conversations/${activeId}?poll=1`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      if (!data?.conversation) return;

      setThreadViewerUserId(data.viewerUserId || myId);
      setThreadViewerUsername(
        data.viewerUsername || account?.username || null,
      );
      setActiveConversation(data.conversation as Conversation);
      setProposalAccess(
        (data.paymentsProposalAccess as PaymentsProposalAccess | undefined) ??
          null,
      );
      if (typeof data.activePaymentTicketCount === "number") {
        setActiveTicketCount(data.activePaymentTicketCount);
      }

      const rawMsgs = (data.messages as Message[]) ?? [];
      const tickets =
        (data.paymentTickets as TimelineTicketLite[] | undefined) ?? [];
      setPaymentTickets(visibleChatTickets(tickets));
      const merged = mergePaymentTicketsClient(activeId, rawMsgs, tickets);
      setMessages((prev) => {
        const serverIds = new Set(merged.map((m) => m.id));
        const optimistic = prev.filter(
          (m) =>
            !serverIds.has(m.id) &&
            m.id.startsWith("tmp-") &&
            m.conversationId === activeId,
        );
        const next = [...merged];
        for (const o of optimistic) {
          if (!next.some((m) => m.id === o.id)) next.push(o);
        }
        next.sort((a, b) => {
          const at = Date.parse(a.createdAt);
          const bt = Date.parse(b.createdAt);
          if (at !== bt) return at - bt;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        if (
          next.length === prev.length &&
          next.every((m, i) => m.id === prev[i]?.id)
        ) {
          return prev;
        }
        return next;
      });
    } catch {
      /* silent — local ticket state already updated from the action POST */
    } finally {
      requestAnimationFrame(() => {
        if (container) container.scrollTop = savedTop;
      });
    }
  }

  async function loadOlderMessages() {
    if (!activeId || !messagesCursor || loadingOlder) return;
    setLoadingOlder(true);
    shouldScrollRef.current = false;
    try {
      const res = await fetch(
        `/api/conversations/${activeId}/messages?limit=30&cursor=${encodeURIComponent(messagesCursor)}`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load messages");
      const olderRaw = (data.messages as Message[]) ?? [];
      const tickets =
        (data.paymentTickets as TimelineTicketLite[] | undefined) ?? [];
      setPaymentTickets(visibleChatTickets(tickets));
      const older = mergePaymentTicketsClient(activeId, olderRaw, tickets);
      setMessages((prev) => {
        // Prefer real marker ids over payment-ticket: synthetic when both exist.
        const byTicket = new Map<string, string>();
        for (const m of [...older, ...prev]) {
          if (!m.paymentTicketId) continue;
          const existing = byTicket.get(m.paymentTicketId);
          if (!existing || !m.id.startsWith("payment-ticket:")) {
            byTicket.set(m.paymentTicketId, m.id);
          }
        }
        const ids = new Set<string>();
        const merged: Message[] = [];
        for (const m of [...older, ...prev]) {
          if (m.paymentTicketId) {
            const keepId = byTicket.get(m.paymentTicketId);
            if (keepId && m.id !== keepId) continue;
          }
          if (ids.has(m.id)) continue;
          ids.add(m.id);
          merged.push(m);
        }
        return merged.sort((a, b) => {
          const at = Date.parse(a.createdAt);
          const bt = Date.parse(b.createdAt);
          if (at !== bt) return at - bt;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
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
      setDraftByConversation((prev) => {
        if (!activeId) return prev;
        const next = { ...prev };
        delete next[activeId];
        return next;
      });
      setPendingUrls([]);
      shouldScrollRef.current = nearBottomRef.current;
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
      {!activeId ? <ReviewPrompt /> : null}
      <div className="panel-navy mt-8 flex min-h-[min(70vh,720px)] flex-col overflow-hidden rounded-xl lg:flex-row">
        {/* Conversation list — hidden on mobile while a thread is open */}
        <aside
          className={`w-full shrink-0 flex-col border-b border-white/10 lg:max-h-none lg:w-[340px] lg:border-b-0 lg:border-r ${
            activeId ? "hidden lg:flex" : "flex max-h-[min(70vh,720px)]"
          }`}
        >
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
                  const profileHref = other?.slug
                    ? `/members/${other.slug}`
                    : null;
                  return (
                    <li key={c.id}>
                      <div
                        className={`flex w-full items-start gap-3 px-4 py-3 ${
                          selected
                            ? "bg-electric/15"
                            : "hover:bg-white/[0.04]"
                        }`}
                      >
                        {other?.id ? (
                          <StoryAvatar
                            userId={other.id}
                            profileHref={profileHref}
                            size={40}
                            className="rounded-lg"
                          >
                            <Image
                              src={memberPhoto(other.photo)}
                              alt=""
                              fill
                              sizes="40px"
                              unoptimized
                              className="object-cover"
                            />
                          </StoryAvatar>
                        ) : (
                          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-navy-mid">
                            <Image
                              src={memberPhoto(other?.photo)}
                              alt=""
                              fill
                              sizes="40px"
                              unoptimized
                              className="object-cover"
                            />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => selectConversation(c.id)}
                          className="min-w-0 flex-1 text-left"
                        >
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
                          <p
                            className={`mt-0.5 truncate text-xs ${
                              c.unread ? "text-white/70" : "text-white/40"
                            }`}
                          >
                            {previewText(c.lastMessage)}
                          </p>
                        </button>
                      </div>
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

        {/* Thread — full-width on mobile when selected */}
        <section
          className={`min-h-0 min-w-0 flex-1 flex-col ${
            activeId ? "flex" : "hidden lg:flex"
          }`}
        >
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
                <button
                  type="button"
                  className="text-xs uppercase tracking-[0.12em] text-white/45 hover:text-white lg:hidden"
                  onClick={() => selectConversation(null)}
                >
                  Back
                </button>
                {activeOther?.id ? (
                  <StoryAvatar
                    userId={activeOther.id}
                    profileHref={
                      activeOther.slug ? `/members/${activeOther.slug}` : null
                    }
                    size={36}
                    className="rounded-lg"
                  >
                    <Image
                      src={memberPhoto(activeOther.photo)}
                      alt=""
                      fill
                      sizes="36px"
                      unoptimized
                      className="object-cover"
                    />
                  </StoryAvatar>
                ) : (
                  <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-navy-mid">
                    <Image
                      src={memberPhoto(activeOther?.photo)}
                      alt=""
                      fill
                      sizes="36px"
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {activeOther?.name ||
                      (activeConversation
                        ? conversationTitle(activeConversation, myId)
                        : "Member")}
                  </p>
                  {activeConversation?.contextType === "system" ? (
                    <p className="truncate text-xs uppercase tracking-[0.12em] text-electric">
                      Official notification
                    </p>
                  ) : activeOther?.username ? (
                    <p className="truncate text-xs text-white/45">
                      @{activeOther.username}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                  {activeOther?.slug ? (
                    <Link
                      href={`/members/${activeOther.slug}`}
                      className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-electric hover:text-electric-hover"
                    >
                      View profile
                    </Link>
                  ) : null}
                  {activeConversation?.contextType !== "system" ? (
                    <ProposePaymentTicketButton
                      conversationId={activeId!}
                      myId={myId}
                      otherUserId={activeOther?.id}
                      otherUsername={activeOther?.username}
                      otherDisplayName={activeOther?.name}
                      proposalAccess={proposalAccess}
                      activeTicketCount={activeTicketCount}
                      maxActiveTickets={MAX_ACTIVE_PAYMENT_TICKETS}
                      onCreated={({ ticket, message }) => {
                        shouldScrollRef.current = true;
                        const now = new Date().toISOString();
                        if (!ticket?.id) {
                          console.error(
                            "[payments:propose] onCreated without ticket.id",
                          );
                          return;
                        }
                        setActiveTicketCount((n) => n + 1);
                        setPaymentTickets((prev) => {
                          if (prev.some((t) => t.id === ticket.id)) return prev;
                          return [...prev, ticket as TimelineTicketLite];
                        });
                        setTicketExpanded((prev) => ({
                          ...prev,
                          [ticket.id]: true,
                        }));
                        const msg = (message
                          ? {
                              id: message.id,
                              conversationId: message.conversationId,
                              senderId: message.senderId,
                              body: message.body,
                              createdAt: message.createdAt,
                              messageType:
                                message.messageType || "PAYMENT_TICKET",
                              systemEventType:
                                message.systemEventType ||
                                "PAYMENT_TICKET_PROPOSED",
                              replyAllowed: message.replyAllowed !== false,
                              paymentTicketId:
                                message.paymentTicketId ?? ticket.id,
                              attachments: message.attachments ?? [],
                              sender: message.sender,
                            }
                          : {
                              id: `payment-ticket:${ticket.id}`,
                              conversationId: activeId!,
                              senderId: myId,
                              body: "Payment Ticket",
                              createdAt: now,
                              messageType: "PAYMENT_TICKET",
                              systemEventType: "PAYMENT_TICKET_PROPOSED",
                              replyAllowed: true,
                              paymentTicketId: ticket.id,
                              attachments: [],
                            }) satisfies Message;

                        setMessages((prev) => {
                          if (
                            prev.some(
                              (m) =>
                                m.id === msg.id ||
                                (msg.paymentTicketId &&
                                  m.paymentTicketId === msg.paymentTicketId),
                            )
                          ) {
                            return prev;
                          }
                          return [...prev, msg];
                        });
                        setConversations((prev) => {
                          const updated = prev.map((c) =>
                            c.id === activeId
                              ? {
                                  ...c,
                                  lastMessage: msg,
                                  lastMessageAt: msg.createdAt,
                                  unread: false,
                                }
                              : c,
                          );
                          return [...updated].sort((a, b) => {
                            const at = a.lastMessageAt
                              ? new Date(a.lastMessageAt).getTime()
                              : 0;
                            const bt = b.lastMessageAt
                              ? new Date(b.lastMessageAt).getTime()
                              : 0;
                            return bt - at;
                          });
                        });
                        const convId = activeId;
                        void (async () => {
                          try {
                            const res = await fetch(
                              `/api/conversations/${convId}`,
                              { cache: "no-store" },
                            );
                            if (!res.ok) return;
                            const data = (await res.json()) as {
                              messages?: Message[];
                              paymentTickets?: TimelineTicketLite[];
                              viewerUserId?: string;
                              viewerUsername?: string | null;
                            };
                            setThreadViewerUserId(data.viewerUserId || myId);
                            setThreadViewerUsername(
                              data.viewerUsername || account?.username || null,
                            );
                            const msgs = mergePaymentTicketsClient(
                              convId!,
                              data.messages ?? [],
                              data.paymentTickets,
                            );
                            setMessages(msgs);
                          } catch {
                            /* keep optimistic timeline message */
                          }
                        })();
                      }}
                    />
                  ) : null}
                </div>
              </header>

              <div
                ref={threadScrollRef}
                onScroll={onThreadScroll}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4"
              >
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
                  <div className="space-y-3 py-4" aria-busy="true">
                    <div className="h-16 animate-pulse rounded-xl bg-white/[0.04]" />
                    <div className="ml-auto h-12 w-2/3 animate-pulse rounded-xl bg-white/[0.06]" />
                    <div className="h-14 w-3/4 animate-pulse rounded-xl bg-white/[0.04]" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
                    <p className="text-sm text-white/70">No messages yet</p>
                    <p className="mt-2 text-xs text-white/40">
                      Say hello to start the conversation.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {(() => {
                      // One Payment Ticket card per ticketId (update in place).
                      // Later accept/decline rows stay as compact history lines.
                      const cardShown = new Set<string>();
                      return messages.map((m) => {
                      const isSystem =
                        m.messageType === "SYSTEM" || !m.senderId;
                      const isSourcing =
                        m.messageType === "SOURCING_REQUEST";
                      const isPaymentTicket =
                        m.messageType === "PAYMENT_TICKET" ||
                        Boolean(m.paymentTicketId);
                      const mine = !isSystem && m.senderId === myId;
                      if (isPaymentTicket && m.paymentTicketId) {
                        const isPrimaryCard =
                          m.systemEventType === "PAYMENT_TICKET_PROPOSED" ||
                          !m.systemEventType ||
                          !cardShown.has(m.paymentTicketId);
                        if (isPrimaryCard && !cardShown.has(m.paymentTicketId)) {
                          cardShown.add(m.paymentTicketId);
                          return (
                            <li
                              key={m.paymentTicketId || m.id}
                              className="flex justify-stretch"
                            >
                              <PaymentTicketCard
                                key={m.paymentTicketId}
                                ticketId={m.paymentTicketId}
                                ticketSnapshot={
                                  (paymentTickets.find(
                                    (t) => t.id === m.paymentTicketId,
                                  ) as PaymentTicketView | undefined) ?? null
                                }
                                myId={ticketViewerId}
                                myUsername={
                                  ticketViewerUsername || account?.username
                                }
                                proposedAt={m.createdAt}
                                proposedByName={
                                  m.sender?.username
                                    ? `@${m.sender.username}`
                                    : m.sender?.name || null
                                }
                                expanded={
                                  ticketExpanded[m.paymentTicketId] ?? false
                                }
                                onExpandedChange={(next) =>
                                  setTicketExpanded((prev) => ({
                                    ...prev,
                                    [m.paymentTicketId!]: next,
                                  }))
                                }
                                onChanged={() => {
                                  void refreshConversationPreservingViewport();
                                }}
                              />
                            </li>
                          );
                        }
                        // Historical lifecycle note (accept / decline) — not a second card.
                        return (
                          <li
                            key={m.id}
                            className="flex justify-center px-2"
                          >
                            <p className="max-w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-center text-[11px] text-white/50">
                              {m.body?.trim() || "Payment Ticket update"}
                              <span className="ml-2 text-white/30">
                                {formatTime(m.createdAt)}
                              </span>
                            </p>
                          </li>
                        );
                      }
                      if (isSourcing) {
                        return (
                          <li key={m.id} className="flex justify-stretch">
                            <div className="w-full rounded-xl border border-electric/30 bg-electric/10 px-4 py-3">
                              <div className="flex items-baseline justify-between gap-3">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-electric">
                                  Sourcing request
                                </p>
                                <p className="text-[10px] text-white/35">
                                  {formatTime(m.createdAt)}
                                </p>
                              </div>
                              {!mine ? (
                                <p className="mt-1 text-[11px] text-white/45">
                                  From {displayName(m.sender ?? null)}
                                </p>
                              ) : (
                                <p className="mt-1 text-[11px] text-white/45">
                                  You sent
                                </p>
                              )}
                              {m.body?.trim() ? (
                                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/85">
                                  {m.body}
                                </p>
                              ) : null}
                              {m.attachments?.length ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {m.attachments.map((a) => (
                                    <a
                                      key={a.id}
                                      href={a.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="relative h-16 w-16 overflow-hidden rounded-lg border border-white/15"
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
                            </div>
                          </li>
                        );
                      }
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
                    });
                    })()}
                  </ul>
                )}
                {newMessageHint ? (
                  <button
                    type="button"
                    className="sticky bottom-2 mx-auto mt-2 rounded-full border border-electric/40 bg-[#061228]/95 px-3 py-1.5 text-[11px] font-medium text-electric shadow-lg"
                    onClick={() => {
                      shouldScrollRef.current = true;
                      setNewMessageHint(false);
                      const container = threadScrollRef.current;
                      if (container) {
                        container.scrollTop = container.scrollHeight;
                        nearBottomRef.current = true;
                      }
                    }}
                  >
                    New message
                  </button>
                ) : null}
                <div ref={threadEndRef} />
              </div>

              {threadLoading && !activeConversation ? (
                <div className="border-t border-white/10 px-4 py-4 text-sm text-white/45">
                  Loading conversation…
                </div>
              ) : !activeConversation ? (
                <div className="border-t border-white/10 px-4 py-4 text-sm text-white/50">
                  <p>Unable to load this conversation.</p>
                  <button
                    type="button"
                    className="mt-2 text-xs uppercase tracking-[0.12em] text-electric hover:text-electric-hover"
                    onClick={() => selectConversation(null)}
                  >
                    Back to inbox
                  </button>
                </div>
              ) : activeConversation.contextType === "system" ||
                messages.some((m) => m.replyAllowed === false) ? (
                <div className="border-t border-white/10 px-4 py-4 text-sm text-white/50">
                  This is an official Source Bridge notification. Replies are
                  disabled.
                </div>
              ) : (() => {
                  const other = otherParticipant(activeConversation, myId);
                  return (
                    Boolean(other) &&
                    other!.name === "Deleted user" &&
                    !other!.username &&
                    !other!.slug
                  );
                })() ? (
                <div className="border-t border-white/10 px-4 py-4 text-sm text-white/50">
                  This account is no longer available. Messaging is disabled.
                </div>
              ) : (
              <div className="border-t border-white/10 px-3 py-3 sm:px-4">
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
                <form onSubmit={onSubmit} className="flex items-end gap-2">
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
                </form>
              </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
