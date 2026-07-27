"use client";

import { useEffect, useState } from "react";
import { useAppUi } from "@/components/providers/AppProviders";

type Party = {
  id: string;
  name: string;
  username: string | null;
  slug: string | null;
  photo: string;
};

type Transaction = {
  id: string;
  title: string;
  buyerId: string;
  sellerId: string;
  buyer?: Party;
  seller?: Party;
  completedAt: string | null;
};

type ReviewRow = {
  id: string;
  transactionId: string | null;
  reviewerId: string | null;
};

const SKIP_KEY = "sb_review_skipped";

function readSkipped(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SKIP_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeSkipped(ids: Set<string>) {
  try {
    sessionStorage.setItem(SKIP_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

export function ReviewPrompt() {
  const { account, showToast } = useAppUi();
  const [pending, setPending] = useState<Transaction | null>(null);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!account?.id) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/transactions?status=COMPLETED&limit=20");
        if (!res.ok) return;
        const data = (await res.json()) as { transactions?: Transaction[] };
        const txns = data.transactions ?? [];
        if (txns.length === 0) return;

        const skipped = readSkipped();
        const candidates = txns.filter((t) => !skipped.has(t.id));
        if (candidates.length === 0) return;

        const otherIds = [
          ...new Set(
            candidates.map((t) =>
              t.buyerId === account!.id ? t.sellerId : t.buyerId,
            ),
          ),
        ];

        const reviewedTxnIds = new Set<string>();
        await Promise.all(
          otherIds.map(async (userId) => {
            const r = await fetch(
              `/api/reviews?userId=${encodeURIComponent(userId)}&limit=50`,
            );
            if (!r.ok) return;
            const body = (await r.json()) as { reviews?: ReviewRow[] };
            for (const review of body.reviews ?? []) {
              if (
                review.transactionId &&
                review.reviewerId === account!.id
              ) {
                reviewedTxnIds.add(review.transactionId);
              }
            }
          }),
        );

        if (cancelled) return;
        const next = candidates.find((t) => !reviewedTxnIds.has(t.id)) ?? null;
        if (next) {
          setPending(next);
          setOpen(true);
        }
      } catch {
        /* ignore */
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [account]);

  if (!open || !pending || !account) return null;

  const other =
    pending.buyerId === account.id ? pending.seller : pending.buyer;
  const otherLabel = other?.username
    ? `@${other.username}`
    : other?.name || "this member";

  function skip() {
    const skipped = readSkipped();
    skipped.add(pending!.id);
    writeSkipped(skipped);
    setOpen(false);
    setPending(null);
  }

  async function submit() {
    if (!text.trim()) {
      showToast("Please write a short review");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: pending!.id,
          rating,
          text: text.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not submit review");
      showToast("Thanks for your review");
      setOpen(false);
      setPending(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not submit review");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 sm:items-center">
      <div
        role="dialog"
        aria-labelledby="review-prompt-title"
        className="panel-navy w-full max-w-md rounded-xl border border-electric/25 px-5 py-6 shadow-[0_0_40px_rgba(59,130,246,0.15)] sm:px-6"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-electric">
          Leave a review
        </p>
        <h2
          id="review-prompt-title"
          className="mt-2 font-display text-2xl text-white"
        >
          How was your deal with {otherLabel}?
        </h2>
        <p className="mt-2 text-sm text-white/55">
          {pending.title?.trim()
            ? pending.title
            : "A completed transaction is waiting for your feedback."}
        </p>

        <div className="mt-5 flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              className={`flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-semibold transition-colors ${
                n <= rating
                  ? "border-electric/50 bg-electric/20 text-electric"
                  : "border-white/15 text-white/40 hover:border-white/30"
              }`}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
            >
              {n}
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Share what went well or what to improve…"
          className="mt-4 w-full resize-none rounded-lg border border-white/15 bg-[#061228] px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-electric/50 focus:outline-none"
        />

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={skip}
            disabled={busy}
            className="inline-flex h-11 items-center rounded-lg border border-white/20 px-4 text-xs font-medium uppercase tracking-[0.14em] text-white/70 hover:border-white/40 hover:text-white disabled:opacity-50"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="inline-flex h-11 items-center rounded-lg bg-electric px-5 text-xs font-medium uppercase tracking-[0.14em] text-white hover:bg-electric-hover disabled:opacity-50"
          >
            {busy ? "Sending…" : "Submit review"}
          </button>
        </div>
      </div>
    </div>
  );
}
