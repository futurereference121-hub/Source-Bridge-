"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAppUi } from "@/components/providers/AppProviders";
import {
  EditorField,
  EditorShell,
  EditorSubmit,
  apiJson,
  editorInputClass,
  jsonBody,
} from "@/components/profile/editors/EditorShell";

type CategoryRow = { id: string; name: string };

type OpportunityEditorProps = {
  onClose: () => void;
  opportunityId?: string | null;
  defaults?: {
    title?: string;
    description?: string;
    city?: string;
    country?: string;
    category?: string;
  };
};

const blank = {
  title: "",
  description: "",
  city: "",
  country: "",
  category: "",
  expiresAt: "",
};

export function OpportunityEditor({
  onClose,
  opportunityId,
  defaults,
}: OpportunityEditorProps) {
  const router = useRouter();
  const { showToast } = useAppUi();
  const [form, setForm] = useState({
    ...blank,
    title: defaults?.title || "",
    description: defaults?.description || "",
    city: defaults?.city || "",
    country: defaults?.country || "",
    category: defaults?.category || "",
  });
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(opportunityId));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const catData = await apiJson("/api/categories");
        if (!cancelled) setCategories(catData.categories || []);
        if (opportunityId) {
          const data = await apiJson("/api/opportunities");
          const row = (data.opportunities || []).find(
            (o: { id: string }) => o.id === opportunityId,
          );
          if (row && !cancelled) {
            setForm({
              title: row.title || "",
              description: row.description || "",
              city: row.city || "",
              country: row.country || "",
              category: row.category || "",
              expiresAt: row.expiresAt?.slice(0, 10) || "",
            });
          }
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
    setBusy(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        city: form.city.trim(),
        country: form.country.trim(),
        category: form.category,
        expiresAt: form.expiresAt
          ? new Date(`${form.expiresAt}T23:59:59`).toISOString()
          : null,
      };
      if (opportunityId) {
        await apiJson(
          `/api/opportunities/${opportunityId}`,
          jsonBody("PATCH", payload),
        );
      } else {
        await apiJson("/api/opportunities", jsonBody("POST", payload));
      }
      showToast("Opportunity saved");
      onClose();
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save");
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
          <EditorField label="Title">
            <input
              className={editorInputClass}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              maxLength={120}
            />
          </EditorField>
          <EditorField label="Category">
            <select
              className={editorInputClass}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              required
            >
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </EditorField>
          <div className="sm:col-span-2">
            <EditorField label="Description">
              <textarea
                className={`${editorInputClass} min-h-28 py-3`}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                required
                maxLength={2000}
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
          <EditorField label="Optional expiry">
            <input
              type="date"
              className={editorInputClass}
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            />
          </EditorField>
          <div className="flex items-end">
            <EditorSubmit busy={busy}>
              {opportunityId ? "Save changes" : "Post opportunity"}
            </EditorSubmit>
          </div>
        </form>
      )}
    </EditorShell>
  );
}
