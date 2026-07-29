"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Briefcase,
  CircleDot,
  Mail,
  MessageSquare,
} from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { formatRelativeTime } from "@/lib/format";
import type { NotificationItem, NotificationType } from "@/lib/types";

function iconForType(type: NotificationType) {
  switch (type) {
    case "OPPORTUNITY":
      return { Icon: Briefcase, className: "text-amber-300" };
    case "STATUS":
      return { Icon: CircleDot, className: "text-sky-300/85" };
    case "MESSAGE":
      return { Icon: MessageSquare, className: "text-electric" };
    case "SOURCING_REQUEST":
    case "LISTING_ENQUIRY":
    case "OPPORTUNITY_ENQUIRY":
      return { Icon: Mail, className: "text-electric" };
    default:
      return { Icon: Bell, className: "text-white/55" };
  }
}

export function NotificationBell() {
  const { items, unreadCount, markRead, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggleOpen() {
    setOpen((v) => {
      const next = !v;
      if (next) {
        void refresh();
        if (unreadCount > 0) void markRead();
      }
      return next;
    });
  }

  function handleItemClick(item: NotificationItem) {
    if (!item.read) void markRead([item.id]);
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleOpen}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-white/75 transition-colors hover:text-white"
      >
        <Bell size={19} strokeWidth={1.75} />
        {unreadCount > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-electric px-1 text-[9px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-white/12 bg-[#04122a] shadow-2xl shadow-black/40 ring-1 ring-electric/20"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <p className="text-sm font-medium text-white">Notifications</p>
            {items.some((i) => !i.read) ? (
              <button
                type="button"
                onClick={() => void markRead()}
                className="text-[11px] uppercase tracking-[0.12em] text-electric hover:text-electric-hover"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length ? (
              items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onClick={() => handleItemClick(item)}
                />
              ))
            ) : (
              <p className="px-4 py-8 text-center text-sm text-white/45">
                No notifications yet.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NotificationRow({
  item,
  onClick,
}: {
  item: NotificationItem;
  onClick: () => void;
}) {
  const { Icon, className } = iconForType(item.type);
  const relative = formatRelativeTime(item.createdAt);
  const content = (
    <div
      className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.05] ${
        item.read ? "" : "bg-electric/[0.06]"
      }`}
    >
      <span className="mt-0.5 shrink-0">
        <Icon size={16} strokeWidth={1.75} className={className} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-white/90">{item.title}</p>
        {item.body ? (
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-white/50">
            {item.body}
          </p>
        ) : null}
        {relative ? (
          <p className="mt-1 text-[11px] text-white/35">{relative}</p>
        ) : null}
      </div>
      {!item.read ? (
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-electric" />
      ) : null}
    </div>
  );

  if (item.href) {
    return (
      <Link href={item.href} role="menuitem" onClick={onClick} className="block">
        {content}
      </Link>
    );
  }
  return (
    <button type="button" role="menuitem" onClick={onClick} className="block w-full text-left">
      {content}
    </button>
  );
}
