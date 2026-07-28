"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import {
  uploadProfileImageFile,
  validateImageFileClient,
} from "@/lib/client-image-upload";
import { IMAGE_ACCEPT_ATTR } from "@/lib/storage-constants";
import { memberPhoto } from "@/lib/placeholders";

export type SourcingRecipient = {
  id: string;
  username: string;
  fullName: string;
  photo: string;
  locationLabel: string;
  isRealAccount?: boolean;
  isPrototype?: boolean;
};

type ListingContext = {
  id: string;
  name: string;
  cover?: string;
  priceLabel?: string;
};

type OpportunityContext = {
  id: string;
  title: string;
};

type ImageSlot = {
  clientId: string;
  previewUrl: string | null;
  url: string | null;
  status: "uploading" | "uploaded" | "failed";
  error: string | null;
  file: File | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  recipient: SourcingRecipient;
  listing?: ListingContext | null;
  opportunity?: OpportunityContext | null;
  initialMessage?: string;
};

function newId() {
  return `sr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function SourcingRequestComposer({
  open,
  onClose,
  recipient,
  listing,
  opportunity,
  initialMessage = "",
}: Props) {
  const router = useRouter();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { account, showToast } = useAppUi();
  const [message, setMessage] = useState(initialMessage);
  const [neededFrom, setNeededFrom] = useState(recipient.locationLabel || "");
  const [budget, setBudget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [images, setImages] = useState<ImageSlot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clientRequestId] = useState(() => newId());
  const dirty =
    Boolean(message.trim()) ||
    Boolean(budget.trim()) ||
    Boolean(deadline) ||
    images.length > 0;

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setMessage(initialMessage);
    setNeededFrom(recipient.locationLabel || "");
    setBudget("");
    setDeadline("");
    setImages([]);
    setError("");
  }, [open, initialMessage, recipient.locationLabel]);

  const uploading = images.some((i) => i.status === "uploading");
  const canSend =
    Boolean(message.trim()) &&
    !uploading &&
    !busy &&
    !images.some((i) => i.status === "failed" || i.status === "uploading");

  function requestClose() {
    if (busy || uploading) return;
    if (dirty && !window.confirm("Discard this sourcing request?")) return;
    onClose();
  }

  async function uploadFile(file: File) {
    if (images.length >= 3) {
      showToast("You can attach up to 3 images");
      return;
    }
    const err = validateImageFileClient(file);
    if (err) {
      showToast(err);
      return;
    }
    if (!account) return;
    const clientId = newId();
    const previewUrl = URL.createObjectURL(file);
    setImages((prev) => [
      ...prev,
      {
        clientId,
        previewUrl,
        url: null,
        status: "uploading",
        error: null,
        file,
      },
    ]);
    try {
      const result = await uploadProfileImageFile({
        file,
        folder: "misc",
        kind: "stock",
        userId: account.id,
      });
      if (result.previewUrl) URL.revokeObjectURL(result.previewUrl);
      setImages((prev) =>
        prev.map((slot) =>
          slot.clientId === clientId
            ? {
                ...slot,
                url: result.url,
                previewUrl: result.url,
                status: "uploaded",
                file: null,
              }
            : slot,
        ),
      );
      URL.revokeObjectURL(previewUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setImages((prev) =>
        prev.map((slot) =>
          slot.clientId === clientId
            ? { ...slot, status: "failed", error: msg }
            : slot,
        ),
      );
    }
  }

  async function retry(slot: ImageSlot) {
    if (!slot.file || !account) return;
    setImages((prev) =>
      prev.map((s) =>
        s.clientId === slot.clientId
          ? { ...s, status: "uploading", error: null }
          : s,
      ),
    );
    try {
      const result = await uploadProfileImageFile({
        file: slot.file,
        folder: "misc",
        kind: "stock",
        userId: account.id,
      });
      setImages((prev) =>
        prev.map((s) =>
          s.clientId === slot.clientId
            ? {
                ...s,
                url: result.url,
                previewUrl: result.url,
                status: "uploaded",
                file: null,
              }
            : s,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setImages((prev) =>
        prev.map((s) =>
          s.clientId === slot.clientId
            ? { ...s, status: "failed", error: msg }
            : s,
        ),
      );
    }
  }

  async function onSubmit() {
    if (!canSend) return;
    if (account?.id === recipient.id) {
      setError("You cannot send a sourcing request to yourself");
      return;
    }
    if (recipient.isPrototype || recipient.isRealAccount === false) {
      setError(
        "This is a demo catalogue profile. Messaging works with real Source Bridge members.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const permanent = images
        .filter((i) => i.status === "uploaded" && i.url && !i.url.startsWith("blob:"))
        .map((i) => i.url as string);
      const res = await fetch("/api/sourcing-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toUserId: recipient.id,
          message: message.trim(),
          neededFrom: neededFrom.trim(),
          budget: budget.trim(),
          deadline: deadline || "",
          referenceImages: permanent,
          clientRequestId,
          listingId: listing?.id || undefined,
          opportunityId: opportunity?.id || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send request");
      const conversationId = data.conversation?.id as string | undefined;
      showToast(
        data.existing
          ? "Opening your existing conversation"
          : "Sourcing request sent",
      );
      onClose();
      router.push(
        conversationId ? `/inbox/${conversationId}` : "/inbox",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send request");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const today = new Date().toISOString().slice(0, 10);
  const photo = memberPhoto(recipient.photo);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 m-auto max-h-[min(92svh,40rem)] w-[min(100%,28rem)] overflow-hidden rounded-xl border border-white/15 bg-[#071428] p-0 text-white shadow-2xl backdrop:bg-black/50"
      onClose={requestClose}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) requestClose();
      }}
    >
      <div className="flex max-h-[min(92svh,40rem)] flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
              {listing
                ? "Listing enquiry"
                : opportunity
                  ? "Opportunity enquiry"
                  : "Sourcing request"}
            </p>
            <h2 id={titleId} className="mt-1 font-display text-2xl text-white">
              Message @{recipient.username}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="rounded-lg p-1.5 text-white/45 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-navy-mid">
              <Image src={photo} alt="" fill sizes="48px" className="object-cover" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">
                @{recipient.username}
              </p>
              {recipient.fullName ? (
                <p className="truncate text-xs text-white/55">{recipient.fullName}</p>
              ) : null}
              {recipient.locationLabel ? (
                <p className="truncate text-xs text-white/40">
                  {recipient.locationLabel}
                </p>
              ) : null}
            </div>
          </div>

          {listing ? (
            <div className="rounded-lg border border-electric/25 bg-electric/10 px-3 py-2 text-xs text-white/80">
              About listing: <strong>{listing.name}</strong>
              {listing.priceLabel ? ` · ${listing.priceLabel}` : ""}
            </div>
          ) : null}

          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.14em] text-white/45">
              What are you looking for? *
            </span>
            <textarea
              className="mt-2 min-h-28 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2.5 text-sm text-white outline-none focus:border-electric/50"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe the item, service, information, or local assistance you need."
              maxLength={5000}
              required
            />
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.14em] text-white/45">
              Needed from
            </span>
            <input
              className="mt-2 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2.5 text-sm text-white outline-none focus:border-electric/50"
              value={neededFrom}
              onChange={(e) => setNeededFrom(e.target.value)}
              placeholder="City, region, or country"
              maxLength={200}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.14em] text-white/45">
                Budget
              </span>
              <input
                className="mt-2 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2.5 text-sm text-white outline-none focus:border-electric/50"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="$100 · Open to discussion"
                maxLength={80}
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.14em] text-white/45">
                Deadline
              </span>
              <input
                type="date"
                min={today}
                className="mt-2 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2.5 text-sm text-white outline-none focus:border-electric/50"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">
                Reference images (optional, max 3)
              </p>
              <label className="cursor-pointer text-[10px] uppercase tracking-[0.14em] text-electric hover:text-electric-hover">
                Add
                <input
                  type="file"
                  accept={IMAGE_ACCEPT_ATTR}
                  className="hidden"
                  disabled={images.length >= 3 || busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadFile(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {images.length ? (
              <ul className="mt-3 grid grid-cols-3 gap-2">
                {images.map((slot) => (
                  <li
                    key={slot.clientId}
                    className="relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-black/20"
                  >
                    {slot.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={slot.previewUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                    {slot.status === "uploading" ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] uppercase tracking-wide">
                        Uploading
                      </div>
                    ) : null}
                    {slot.status === "failed" ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-950/80 p-1 text-center text-[10px] text-red-100">
                        Failed
                        <button
                          type="button"
                          className="underline"
                          onClick={() => void retry(slot)}
                        >
                          Retry
                        </button>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white"
                      onClick={() =>
                        setImages((prev) =>
                          prev.filter((s) => s.clientId !== slot.clientId),
                        )
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>

        <div className="flex flex-wrap gap-3 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            className="inline-flex h-11 items-center rounded-lg border border-white/20 px-5 text-xs font-medium uppercase tracking-[0.14em] text-white/80 hover:border-white/40 disabled:opacity-50"
          >
            Cancel
          </button>
          <PrimaryButton
            type="button"
            showArrow={false}
            disabled={!canSend}
            onClick={() => void onSubmit()}
            className="rounded-lg"
          >
            {busy ? "Sending…" : "Send Request"}
          </PrimaryButton>
        </div>
      </div>
    </dialog>
  );
}
