"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppUi } from "@/components/providers/AppProviders";

/**
 * Authenticated visitors on `/` → `/explore`.
 * Preserves deep links (?next=), admin sessions, and unauthenticated home.
 */
export function HomeAuthRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signedIn, authReady, account } = useAppUi();

  useEffect(() => {
    if (!authReady || !signedIn || !account) return;
    if (account.role === "ADMIN") return;

    const next = searchParams.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      if (next === "/" || next.startsWith("/admin")) return;
      router.replace(next);
      return;
    }

    router.replace("/explore");
  }, [authReady, signedIn, account, router, searchParams]);

  return null;
}
