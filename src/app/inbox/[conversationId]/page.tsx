"use client";

import { Suspense, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { MessagesInbox } from "@/components/messaging/MessagesInbox";
import { useAppUi } from "@/components/providers/AppProviders";

export default function InboxThreadPage() {
  const router = useRouter();
  const params = useParams<{ conversationId: string }>();
  const { signedIn, authReady, account } = useAppUi();
  const conversationId = params.conversationId;

  useEffect(() => {
    if (authReady && !signedIn) {
      router.replace(
        `/sign-in?next=${encodeURIComponent(`/inbox/${conversationId}`)}`,
      );
    }
  }, [authReady, signedIn, router, conversationId]);

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
        <h1 className="mt-2 font-display text-4xl text-white">Inbox</h1>
        <Suspense
          fallback={
            <p className="mt-8 text-sm text-white/45">Loading conversation…</p>
          }
        >
          <MessagesInbox initialConversationId={conversationId} />
        </Suspense>
      </Container>
    </div>
  );
}
