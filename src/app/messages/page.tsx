"use client";

import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { useAppUi } from "@/components/providers/AppProviders";

export default function MessagesPage() {
  const { openPlaceholder, requireAuth, signedIn } = useAppUi();

  return (
    <div className="pt-28 pb-20">
      <Container className="max-w-xl">
        <h1 className="font-display text-4xl text-ink">Messages</h1>
        <p className="mt-3 text-muted">
          Direct conversations with members will live here.
        </p>
        <Button
          type="button"
          className="mt-8"
          onClick={() => {
            if (!requireAuth("open messages")) return;
            openPlaceholder(
              "Inbox coming soon",
              "Messaging is a prototype placeholder. Real-time chat and notifications will plug in later.",
            );
          }}
        >
          Check inbox
        </Button>
        {signedIn ? (
          <p className="mt-10 border border-border bg-surface p-6 text-sm text-muted">
            Your inbox is empty — prototype placeholder.
          </p>
        ) : null}
      </Container>
    </div>
  );
}
