"use client";

import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { useAppUi } from "@/components/providers/AppProviders";

export default function RequestsPage() {
  const { openPlaceholder, requireAuth, signedIn } = useAppUi();

  return (
    <div className="pt-28 pb-20">
      <Container className="max-w-xl">
        <h1 className="font-display text-4xl text-ink">Requests</h1>
        <p className="mt-3 text-muted">
          Sourcing requests you send or receive will appear here.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={() => {
              if (!requireAuth("create a sourcing request")) return;
              openPlaceholder(
                "New sourcing request",
                "Describe what you need and where. Matching and messaging will connect here in a later release.",
              );
            }}
          >
            New request
          </Button>
          <Button href="/explore" variant="outline">
            Browse members
          </Button>
        </div>
        {!signedIn ? (
          <p className="mt-6 text-sm text-muted-light">
            Sign in to create and track requests.
          </p>
        ) : (
          <p className="mt-10 border border-border bg-surface p-6 text-sm text-muted">
            No open requests yet — prototype placeholder.
          </p>
        )}
      </Container>
    </div>
  );
}
