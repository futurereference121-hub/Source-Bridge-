"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import AdminSignOutButton from "./AdminSignOutButton";

const TABS = [
  { href: "/admin/verifications", label: "Verification Applicants" },
  { href: "/admin/payments", label: "Protected Payments" },
  { href: "/admin/reviews", label: "Reviews & Disputes" },
  { href: "/admin/live", label: "Live" },
] as const;

function tabActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Client admin tab nav — keeps shell mounted, shows local pending state,
 * and uses soft navigation with transition so failed RSC loads do not dump
 * the operator onto the marketing homepage.
 */
export default function AdminNav() {
  const pathname = usePathname() || "/admin";
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go(href: string) {
    if (tabActive(pathname, href)) return;
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <nav
      className="mx-auto mb-10 flex max-w-6xl flex-wrap items-center gap-6 text-sm text-white/70"
      aria-label="Admin"
      data-testid="admin-nav"
      data-pending={pending ? "true" : "false"}
    >
      {TABS.map((tab) => {
        const active = tabActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch
            onClick={(e) => {
              // Soft client transition; still allow modified-click open-in-new-tab.
              if (
                e.metaKey ||
                e.ctrlKey ||
                e.shiftKey ||
                e.altKey ||
                e.button !== 0
              ) {
                return;
              }
              e.preventDefault();
              go(tab.href);
            }}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "font-semibold text-white"
                : "font-medium text-electric hover:text-electric-hover"
            }
            data-testid={`admin-nav-${tab.href.replace("/admin/", "")}`}
          >
            {tab.label}
          </Link>
        );
      })}
      {pending ? (
        <span
          className="text-[11px] uppercase tracking-[0.12em] text-white/40"
          data-testid="admin-nav-loading"
        >
          Loading…
        </span>
      ) : null}
      <AdminSignOutButton />
    </nav>
  );
}
