"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAppUi } from "@/components/providers/AppProviders";
import {
  EditorField,
  EditorShell,
  EditorSubmit,
  apiJson,
  editorInputClass,
  jsonBody,
} from "@/components/profile/editors/EditorShell";

type OpportunityEditorProps = {
  onClose: () => void;
  opportunityId?: string | null;
  defaults?: {
    description?: string;
    city?: string;
    country?: string;
  };
  /** Called after a successful create so the parent can refresh Live Activity. */
  onPublished?: () => void;
};

const blank = {
  description: "",
  city: "",
  country: "",
  startsAt: "",
  expiresAt: "",
};

export function OpportunityEditor({
  onClose,
  opportunityId,
  defaults,
  onPublished,
}: OpportunityEditorProps) {
  const { showToast } = useAppUi();
  const [form, setForm] = useState({
    ...blank,
    description: defaults?.description || "",
    city: defaults?.city || "",
    country: defaults?.country || "",
  });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(opportunityId));

  useEffect(() => {
    let cancelled = false;
    if (!opportunityId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const data = await apiJson("/api/opportunities");
        const row = (data.opportunities || []).find(
          (o: { id: string }) => o.id === opportunityId,
        );
        if (row && !cancelled) {
          setForm({
            description: row.description || "",
            city: row.city || "",
            country: row.country || "",
            startsAt: row.startsAt?.slice(0, 10) || "",
            expiresAt: row.expiresAt?.slice(0, 10) || "",
          });
        }
      } catch (err) {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opportunityId, showToast]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const payload = {
        description: form.description.trim(),
        city: form.city.trim(),
        country: form.country.trim(),
        startsAt: form.startsAt
          ? new Date(`${form.startsAt}T00:00:00`).toISOString()
          : null,
        expiresAt: form.expiresAt
          ? new Date(`${form.expiresAt}T23:59:59`).toISOString()
          : null,
      };
      if (opportunityId) {
        await apiJson(
          `/api/opportunities/${opportunityId}`,
          jsonBody("PATCH", payload),
        );
        showToast("Opportunity updated successfully.");
      } else {
        await apiJson("/api/opportunities", jsonBody("POST", payload));
        showToast("Opportunity posted successfully.");
        onPublished?.();
      }
      // Close immediately after confirmed success — no extra delay.
      onClose();
    } catch {
      showToast("Opportunity could not be published. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditorShell
      title={opportunityId ? "Edit Opportunity" : "Post Opportunity"}
      onClose={onClose}
      wide
    >
      {loading ? (
        <p className="text-sm text-white/45">Loading…</p>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <EditorField label="Opportunity Description">
              <textarea
                className={`${editorInputClass} min-h-28 py-3`}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                required
                maxLength={2000}
                placeholder="What are you looking for or offering?"
              />
            </EditorField>
          </div>
          <EditorField label="City">
            <input
              className={editorInputClass}
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              required
            />
          </EditorField>
          <EditorField label="Country">
            <input
              className={editorInputClass}
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              required
            />
          </EditorField>
          <EditorField label="Start Date (optional)">
            <input
              type="date"
              className={editorInputClass}
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            />
          </EditorField>
          <EditorField label="End Date (optional)">
            <input
              type="date"
              className={editorInputClass}
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            />
          </EditorField>
          <div className="sm:col-span-2 flex items-end">
            <EditorSubmit busy={busy}>
              {busy
                ? "Publishing…"
                : opportunityId
                  ? "Save changes"
                  : "Publish opportunity"}
            </EditorSubmit>
          </div>
        </form>
      )}
    </EditorShell>
  );
}
