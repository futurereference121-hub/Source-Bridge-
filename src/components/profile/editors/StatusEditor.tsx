"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAppUi } from "@/components/providers/AppProviders";
import { STATUS_TEXT_MAX } from "@/lib/limits";
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
};

export function StatusEditor({
  onClose,
  initialText = "",
  mode = "create",
}: StatusEditorProps) {
  const router = useRouter();
  const { showToast } = useAppUi();
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "edit") {
        await apiJson("/api/status", jsonBody("PATCH", { text: text.trim() }));
        showToast("Status updated.");
      } else {
        await apiJson(
          "/api/status",
          jsonBody("POST", {
            text: text.trim(),
            idempotencyKey: `status_${Date.now()}`,
          }),
        );
        showToast("Status published successfully.");
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
        supersedes the previous. Maximum 3 posts per day.
      </p>
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
            disabled={busy}
          />
          <span className="mt-1 block text-right text-xs text-white/35">
            {text.length}/{STATUS_TEXT_MAX}
          </span>
        </EditorField>
        <EditorSubmit busy={busy}>
          {busy
            ? mode === "edit"
              ? "Saving…"
              : "Publishing…"
            : mode === "edit"
              ? "Save status"
              : "Publish status"}
        </EditorSubmit>
        {mode === "edit" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onDelete()}
            className="w-full rounded-lg border border-amber-400/30 px-3 py-2 text-xs text-amber-100 disabled:opacity-50"
          >
            Delete status
          </button>
        ) : null}
      </form>
    </EditorShell>
  );
}
