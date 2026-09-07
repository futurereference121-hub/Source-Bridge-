"use client";

import { useId, useRef, useState } from "react";
import { LIVE_COMMENT_MAX_LENGTH } from "@/lib/live/realtime/constants";

type Props = {
  disabled?: boolean;
  hidden?: boolean;
  onSend: (
    body: string,
    clientMessageId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};

/**
 * Compact public Live comment composer — keeps focus in overlay so mobile
 * keyboard does not remount the WHEP <video>.
 */
export function LiveCommentComposer({ disabled, hidden, onSend }: Props) {
  const inputId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lockRef = useRef(false);

  if (hidden) return null;

  async function submit() {
    if (disabled || busy || lockRef.current) return;
    const body = text.trim();
    if (!body) return;
    lockRef.current = true;
    setBusy(true);
    setError(null);
    const clientMessageId = `lc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      const result = await onSend(body, clientMessageId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setText("");
    } finally {
      setBusy(false);
      lockRef.current = false;
    }
  }

  return (
    <div
      className="pointer-events-auto absolute bottom-0 left-0 right-0 z-[7] px-3 pt-2"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Add a comment
        </label>
        <input
          id={inputId}
          type="text"
          enterKeyHint="send"
          autoComplete="off"
          maxLength={LIVE_COMMENT_MAX_LENGTH}
          value={text}
          disabled={disabled || busy}
          onChange={(e) => setText(e.target.value.slice(0, LIVE_COMMENT_MAX_LENGTH))}
          placeholder="Add a comment…"
          className="min-h-10 flex-1 rounded-full border border-white/20 bg-black/45 px-3.5 text-sm text-white placeholder:text-white/45 backdrop-blur-sm focus:border-white/40 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || busy || !text.trim()}
          className="min-h-10 shrink-0 rounded-full bg-white/90 px-3 text-xs font-semibold uppercase tracking-[0.1em] text-navy disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
      {error ? (
        <p className="mt-1 text-[11px] text-red-200" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
