"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";

type Props = {
  toUserId: string;
  listingId?: string;
  opportunityId?: string;
  listingName?: string;
  label?: string;
};

export function ContactSellerButton({
  toUserId,
  listingId,
  opportunityId,
  listingName,
  label = "Contact seller",
}: Props) {
  const router = useRouter();
  const { account, requireAuth, showToast } = useAppUi();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (!requireAuth("contact this member")) return;
    if (account?.id === toUserId) {
      showToast("This is your own listing");
      return;
    }
    setBusy(true);
    try {
      const message = listingName
        ? `Hi — I'm interested in “${listingName}”.`
        : "Hi — I'd like to connect about sourcing.";
      const res = await fetch("/api/sourcing-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toUserId,
          message,
          listingId: listingId || undefined,
          opportunityId: opportunityId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start conversation");
      showToast("Conversation started");
      const conversationId = data.conversation?.id as string | undefined;
      router.push(
        conversationId ? `/messages?c=${conversationId}` : "/messages",
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not contact");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PrimaryButton
      type="button"
      showArrow={false}
      disabled={busy}
      onClick={() => void onClick()}
      className="rounded-lg"
    >
      {busy ? "Starting…" : label}
    </PrimaryButton>
  );
}
