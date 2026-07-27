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
};

export function StatusEditor({ onClose, initialText = "" }: StatusEditorProps) {
  const router = useRouter();
  const { showToast } = useAppUi();
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiJson("/api/status", jsonBody("POST", { text: text.trim() }));
      showToast("Status published");
      onClose();
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not publish status");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditorShell title="Update Status" onClose={onClose}>
      <p className="mb-4 text-sm text-white/45">
        Status expires after 24 hours. Maximum 3 posts per day.
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
          />
          <span className="mt-1 block text-right text-xs text-white/35">
            {text.length}/{STATUS_TEXT_MAX}
          </span>
        </EditorField>
        <EditorSubmit busy={busy}>Publish status</EditorSubmit>
      </form>
    </EditorShell>
  );
}
