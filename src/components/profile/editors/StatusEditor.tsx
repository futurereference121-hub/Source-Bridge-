"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAppUi } from "@/components/providers/AppProviders";
import { STATUS_TEXT_MAX } from "@/lib/limits";
import { emitStatusChanged } from "@/lib/status-surface-sync";
import {
  EditorField,
  EditorShell,
  EditorSubmit,
  apiJson,
  editorInputClass,
  jsonBody,
} from "@/components/profile/editors/EditorShell";

type StatusEditorProps = {
  onClose: () => void;
  initialText?: string;
  /** When set, PATCH edits the current active status instead of publishing new. */
  mode?: "create" | "edit";
  memberId?: string;
  memberSlug?: string;
};

type LimitState = {
  remaining: number;
  allowed: boolean;
  nextAllowedAt: string | null;
  cooldownRemainingMs: number;
  serverNow?: string;
};

type StatusPayload = {
  id: string;
  text: string;
  postedAt: string;
  expiresAt: string;
  version?: number;
};

export function StatusEditor({
  onClose,
  initialText = "",
  mode = "create",
  memberId,
  memberSlug,
}: StatusEditorProps) {
  const router = useRouter();
  const { showToast, account } = useAppUi();
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState<LimitState | null>(null);
  const idempotencyKeyRef = useRef(
    `status_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
  const appliedVersionRef = useRef(0);

  useEffect(() => {
    if (mode !== "create") return;
    let cancelled = false;
    void fetch("/api/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { limit?: LimitState }) => {
        if (cancelled || !j.limit) return;
        setLimit({
          remaining: Number(j.limit.remaining ?? 0),
          allowed: Boolean(j.limit.allowed),
          nextAllowedAt: j.limit.nextAllowedAt ?? null,
          cooldownRemainingMs: Number(j.limit.cooldownRemainingMs ?? 0),
          serverNow: j.limit.serverNow,
        });
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const blockedByDaily = mode === "create" && limit != null && !limit.allowed;
  const blockedByCooldown =
    mode === "create" &&
    limit != null &&
    (limit.cooldownRemainingMs || 0) > 0;
  const publishDisabled = busy || blockedByDaily || blockedByCooldown;

  function applyCanonical(status: StatusPayload | null) {
    const version =
      status?.version ??
      (status ? Date.parse(status.postedAt) : Date.now());
    if (version && version < appliedVersionRef.current) return;
    appliedVersionRef.current = Math.max(appliedVersionRef.current, version || 0);
    emitStatusChanged({
      memberId: memberId || account?.id,
      memberSlug: memberSlug || account?.slug || undefined,
      status,
      version,
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (publishDisabled && mode === "create") return;
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "edit") {
        const json = (await apiJson(
          "/api/status",
          jsonBody("PATCH", { text: text.trim() }),
        )) as { status?: StatusPayload };
        if (json.status) applyCanonical(json.status);
        showToast("Status updated.");
      } else {
        const json = (await apiJson(
          "/api/status",
          jsonBody("POST", {
            text: text.trim(),
            idempotencyKey: idempotencyKeyRef.current,
          }),
        )) as { status?: StatusPayload; limit?: LimitState; existing?: boolean };
        if (json.limit) {
          setLimit({
            remaining: Number(json.limit.remaining ?? 0),
            allowed: Boolean(json.limit.allowed),
            nextAllowedAt: json.limit.nextAllowedAt ?? null,
            cooldownRemainingMs: Number(json.limit.cooldownRemainingMs ?? 0),
            serverNow: json.limit.serverNow,
          });
        }
        if (json.status) applyCanonical(json.status);
        showToast(
          json.existing
            ? "Status already published."
            : "Status published successfully.",
        );
      }
      onClose();
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not publish status");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await apiJson("/api/status", { method: "DELETE" });
      applyCanonical(null);
      showToast("Status removed.");
      onClose();
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not delete status");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditorShell
      title={mode === "edit" ? "Edit Status" : "Update Status"}
      onClose={onClose}
    >
      <p className="mb-4 text-sm text-white/45">
        Status expires after 24 hours. One active status at a time — a new post
        supersedes the previous. Maximum 3 posts per day, at least 1 hour apart.
      </p>
      {mode === "create" && blockedByDaily ? (
        <p className="mb-3 text-xs text-amber-200/90" data-testid="status-daily-limit">
          You&apos;ve used your 3 Status updates for today.
        </p>
      ) : null}
      {mode === "create" && blockedByCooldown && !blockedByDaily ? (
        <p className="mb-3 text-xs text-amber-200/90" data-testid="status-cooldown">
          {limit?.cooldownRemainingMs
            ? `You can update your Status again in ${Math.max(
                1,
                Math.ceil(limit.cooldownRemainingMs / 60_000),
              )} minute${
                Math.max(1, Math.ceil(limit.cooldownRemainingMs / 60_000)) === 1
                  ? ""
                  : "s"
              }.`
            : "Wait at least 1 hour between Status updates."}
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4">
        <EditorField label="Status">
          <input
            className={editorInputClass}
            maxLength={STATUS_TEXT_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Share a short update"
            required
            autoFocus
            disabled={busy || publishDisabled}
            data-testid="status-text-input"
          />
          <span className="mt-1 block text-right text-xs text-white/35">
            {text.length}/{STATUS_TEXT_MAX}
          </span>
        </EditorField>
        <EditorSubmit busy={busy} disabled={publishDisabled && mode === "create"}>
          {busy
            ? mode === "edit"
              ? "Saving…"
              : "Publishing…"
            : mode === "edit"
              ? "Save status"
              : "Publish status"}
        </EditorSubmit>
        {mode === "edit" || (mode === "create" && Boolean(initialText)) ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onDelete()}
            className="w-full rounded-lg border border-amber-400/30 px-3 py-2 text-xs text-amber-100 disabled:opacity-50"
            data-testid="status-delete"
          >
            Delete status
          </button>
        ) : null}
      </form>
    </EditorShell>
  );
}
