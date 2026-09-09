"use client";

import { useState } from "react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { SourcingRequestComposer } from "@/components/messaging/SourcingRequestComposer";

type Props = {
  toUserId: string;
  toUsername?: string;
  toName?: string;
  toPhoto?: string;
  toLocation?: string;
  listingId?: string;
  opportunityId?: string;
  listingName?: string;
  listingCover?: string;
  listingPriceLabel?: string;
  opportunityTitle?: string;
  opportunityKindLabel?: string;
  opportunityContextSnapshot?: string;
  label?: string;
  variant?: "primary" | "outline";
  isDemo?: boolean;
  className?: string;
};

export function ContactSellerButton({
  toUserId,
  toUsername = "member",
  toName = "",
  toPhoto = "",
  toLocation = "",
  listingId,
  opportunityId,
  listingName,
  listingCover,
  listingPriceLabel,
  opportunityTitle,
  opportunityKindLabel,
  opportunityContextSnapshot,
  label = "Contact seller",
  variant = "primary",
  isDemo = false,
  className,
}: Props) {
  const { account, requireAuth, showToast } = useAppUi();
  const [open, setOpen] = useState(false);

  function onClick() {
    if (isDemo) {
      showToast(
        "Showcase profiles cannot receive messages. Choose a real member account.",
      );
      return;
    }
    if (!requireAuth("contact this member")) return;
    if (account?.id === toUserId) {
      showToast("This is your own listing");
      return;
    }
    setOpen(true);
  }

  const initialMessage = listingName
    ? `Hi — I'm interested in “${listingName}”.`
    : opportunityTitle
      ? `Hi — I'm interested in your opportunity “${opportunityTitle}”.`
      : "Hi — I'd like to connect about sourcing.";

  return (
    <>
      {variant === "outline" ? (
        <button
          type="button"
          onClick={onClick}
          className={`inline-flex h-11 items-center rounded-lg border border-white/25 px-5 text-xs font-medium uppercase tracking-[0.14em] text-white/85 transition-colors hover:border-white/50 hover:bg-white/5 ${className || ""}`}
        >
          {label}
        </button>
      ) : (
        <PrimaryButton
          type="button"
          showArrow={false}
          onClick={onClick}
          className={`rounded-lg ${className || ""}`}
        >
          {label}
        </PrimaryButton>
      )}
      <SourcingRequestComposer
        open={open}
        onClose={() => setOpen(false)}
        recipient={{
          id: toUserId,
          username: toUsername,
          fullName: toName,
          photo: toPhoto,
          locationLabel: toLocation,
          isRealAccount: true,
        }}
        listing={
          listingId && listingName
            ? {
                id: listingId,
                name: listingName,
                cover: listingCover,
                priceLabel: listingPriceLabel,
              }
            : null
        }
        opportunity={
          opportunityId && opportunityTitle
            ? {
                id: opportunityId,
                title: opportunityTitle,
                kindLabel: opportunityKindLabel,
                contextSnapshot: opportunityContextSnapshot,
              }
            : null
        }
        initialMessage={initialMessage}
      />
    </>
  );
}
