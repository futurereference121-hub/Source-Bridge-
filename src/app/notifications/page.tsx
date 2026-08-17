"use client";

import Link from "next/link";
import { Bell, Briefcase, CircleDot, MessageSquare, ShieldCheck } from "lucide-react";
import { Container } from "@/components/ui/Container";
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
    case "PAYMENT_TICKET":
    case "PAYMENT_STATUS":
    case "PAYMENT_SHIPPING":
    case "PAYMENT_DISPUTE":
      return { Icon: ShieldCheck, className: "text-emerald-300/90" };
    default:
      return { Icon: Bell, className: "text-white/55" };
  }
}

export default function NotificationsPage() {
  const { items, unreadCount, markRead, loading } = useNotifications();

  function onItemClick(item: NotificationItem) {
    if (!item.read) void markRead([item.id]);
  }

  return (
    <div className="min-h-[100svh] bg-app-navy pb-24 pt-28 text-white">
      <Container className="max-w-2xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-electric">
              Activity
            </p>
            <h1 className="mt-2 font-display text-4xl">Notifications</h1>
          </div>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => void markRead()}
              className="text-xs uppercase tracking-[0.12em] text-electric hover:text-electric-hover"
            >
              Mark all read
            </button>
          ) : null}
        </div>

        <div className="mt-8 overflow-hidden rounded-xl border border-white/12 bg-white/[0.03]">
          {loading && !items.length ? (
            <p className="px-4 py-10 text-center text-sm text-white/45">Loading…</p>
          ) : items.length ? (
            items.map((item) => {
              const { Icon, className } = iconForType(item.type);
              const row = (
                <div
                  className={`flex items-start gap-3 px-4 py-4 transition-colors hover:bg-white/[0.04] ${
                    item.read ? "" : "bg-electric/[0.06]"
                  }`}
                >
                  <span className="mt-0.5 shrink-0">
                    <Icon size={18} strokeWidth={1.75} className={className} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-white/90">{item.title}</p>
                    {item.body ? (
                      <p className="mt-0.5 text-xs leading-snug text-white/50">
                        {item.body}
                      </p>
                    ) : null}
                    {formatRelativeTime(item.createdAt) ? (
                      <p className="mt-1 text-[11px] text-white/35">
                        {formatRelativeTime(item.createdAt)}
                      </p>
                    ) : null}
                  </div>
                  {!item.read ? (
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-electric" />
                  ) : null}
                </div>
              );
              if (item.href) {
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => onItemClick(item)}
                    className="block border-b border-white/8 last:border-b-0"
                  >
                    {row}
                  </Link>
                );
              }
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onItemClick(item)}
                  className="block w-full border-b border-white/8 text-left last:border-b-0"
                >
                  {row}
                </button>
              );
            })
          ) : (
            <p className="px-4 py-10 text-center text-sm text-white/45">
              No notifications yet.
            </p>
          )}
        </div>
      </Container>
    </div>
  );
}
