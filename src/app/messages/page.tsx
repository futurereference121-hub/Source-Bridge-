"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { MessagesInbox } from "@/components/messaging/MessagesInbox";
import { useAppUi } from "@/components/providers/AppProviders";

function MessagesLoading() {
  return (
    <div className="panel-navy mt-8 flex min-h-[min(70vh,720px)] items-center justify-center rounded-xl">
      <p className="text-sm text-white/45">Loading inbox…</p>
    </div>
  );
}

export default function MessagesPage() {
  const router = useRouter();
  const { signedIn, authReady, account } = useAppUi();

  useEffect(() => {
    if (authReady && !signedIn) {
      router.replace("/sign-in");
    }
  }, [authReady, signedIn, router]);

  if (!authReady || !account) {
    return (
      <div className="min-h-[100svh] bg-app-navy pb-20 pt-28 text-white">
        <Container className="max-w-6xl">
          <p className="text-white/50">Loading…</p>
        </Container>
      </div>
    );
  }

  return (
    <div className="min-h-[100svh] bg-app-navy pb-24 pt-28 text-white">
      <Container className="max-w-6xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-electric">
          Source Bridge
        </p>
        <h1 className="mt-2 font-display text-4xl text-white">Messages</h1>
        <p className="mt-2 max-w-xl text-sm text-white/55">
          Direct conversations with members across the network.
        </p>
        <Suspense fallback={<MessagesLoading />}>
          <MessagesInbox />
        </Suspense>
      </Container>
    </div>
  );
}
