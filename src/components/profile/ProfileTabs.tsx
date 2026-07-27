"use client";

import Link from "next/link";

export type ProfileTabId =
  | "public"
  | "activity"
  | "listings"
  | "messages"
  | "reviews"
  | "settings";

const OWNER_TABS: { id: ProfileTabId; label: string }[] = [
  { id: "public", label: "Public Profile" },
  { id: "activity", label: "Activity" },
  { id: "listings", label: "Listings" },
  { id: "messages", label: "Messages" },
  { id: "reviews", label: "Reviews" },
  { id: "settings", label: "Settings" },
];

const VISITOR_TABS: { id: ProfileTabId; label: string }[] = [
  { id: "public", label: "Public" },
  { id: "listings", label: "Listings" },
  { id: "reviews", label: "Reviews" },
];

type ProfileTabsProps = {
  slug: string;
  isOwner: boolean;
  active: ProfileTabId;
};

export function ProfileTabs({ slug, isOwner, active }: ProfileTabsProps) {
  const tabs = isOwner ? OWNER_TABS : VISITOR_TABS;

  return (
    <nav
      aria-label="Profile sections"
      className="mt-8 border-b border-white/10"
    >
      <ul className="-mb-px flex gap-1 overflow-x-auto pb-px">
        {tabs.map((tab) => {
          const isActive = active === tab.id;
          const href =
            tab.id === "public"
              ? `/members/${slug}`
              : `/members/${slug}?tab=${tab.id}`;
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                href={href}
                scroll={false}
                className={`inline-flex h-11 items-center border-b-2 px-3 text-xs font-medium uppercase tracking-[0.12em] transition-colors sm:px-4 ${
                  isActive
                    ? "border-electric text-electric"
                    : "border-transparent text-white/45 hover:text-white/80"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function parseProfileTab(
  value: string | null | undefined,
  isOwner: boolean,
): ProfileTabId {
  const allowed = isOwner
    ? OWNER_TABS.map((t) => t.id)
    : VISITOR_TABS.map((t) => t.id);
  if (value && (allowed as string[]).includes(value)) {
    return value as ProfileTabId;
  }
  return "public";
}
