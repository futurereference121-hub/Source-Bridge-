"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import {
  PUBLIC_DISPLAY_MESSAGE_MAX,
  STATUS_TEXT_MAX,
} from "@/lib/limits";

type Category = { name: string; slug: string };

type OpportunityDraft = {
  title: string;
  description: string;
  city: string;
  country: string;
  category: string;
};

type HelpValues = {
  specialties: string[];
  publicDisplayMessage: string;
  statusText: string;
  opportunity: OpportunityDraft | null;
};

type Props = {
  onFinish: (values: HelpValues) => Promise<void>;
  showToast: (message: string) => void;
};

export function HelpStep({ onFinish, showToast }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [statusText, setStatusText] = useState("");
  const [includeOpp, setIncludeOpp] = useState(false);
  const [opp, setOpp] = useState<OpportunityDraft>({
    title: "",
    description: "",
    city: "",
    country: "",
    category: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/categories");
        const data = (await res.json()) as { categories?: Category[] };
        if (!cancelled) setCategories(data.categories || []);
      } catch {
        if (!cancelled) showToast("Could not load categories");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  function toggleCategory(name: string) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name],
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      let opportunity: OpportunityDraft | null = null;
      if (includeOpp) {
        if (
          !opp.title.trim() ||
          !opp.description.trim() ||
          !opp.city.trim() ||
          !opp.country.trim() ||
          !opp.category.trim()
        ) {
          showToast("Fill all opportunity fields or turn it off");
          setSubmitting(false);
          return;
        }
        opportunity = {
          title: opp.title.trim(),
          description: opp.description.trim(),
          city: opp.city.trim(),
          country: opp.country.trim(),
          category: opp.category.trim(),
        };
      }
      await onFinish({
        specialties: selected,
        publicDisplayMessage: message.trim(),
        statusText: statusText.trim(),
        opportunity,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="panel-navy space-y-6 rounded-xl px-5 py-6 sm:px-6"
      onSubmit={handleSubmit}
    >
      <div>
        <h2 className="text-2xl font-semibold text-white">How you can help</h2>
        <p className="mt-1 text-sm text-white/55">
          Pick specialties. Optional extras can wait until later.
        </p>
      </div>

      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-white/45">
          Categories / specialties
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {categories.map((cat) => {
            const active = selected.includes(cat.name);
            return (
              <button
                key={cat.slug || cat.name}
                type="button"
                onClick={() => toggleCategory(cat.name)}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  active
                    ? "border-electric bg-electric/20 text-white"
                    : "border-white/12 bg-white/[0.03] text-white/70 hover:border-electric/35"
                }`}
              >
                {cat.name}
              </button>
            );
          })}
          {categories.length === 0 ? (
            <p className="text-sm text-white/40">Loading categories…</p>
          ) : null}
        </div>
      </div>

      <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
        Public display message{" "}
        <span className="normal-case tracking-normal">(optional)</span>
        <textarea
          value={message}
          onChange={(e) =>
            setMessage(e.target.value.slice(0, PUBLIC_DISPLAY_MESSAGE_MAX))
          }
          rows={2}
          maxLength={PUBLIC_DISPLAY_MESSAGE_MAX}
          className="input-navy mt-1.5 w-full resize-none rounded-lg px-4 py-3 text-sm"
          placeholder="Shown on your member card"
        />
        <span className="mt-1 block text-right text-xs text-white/40">
          {message.length}/{PUBLIC_DISPLAY_MESSAGE_MAX}
        </span>
      </label>

      <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
        First status{" "}
        <span className="normal-case tracking-normal">(optional)</span>
        <textarea
          value={statusText}
          onChange={(e) =>
            setStatusText(e.target.value.slice(0, STATUS_TEXT_MAX))
          }
          rows={2}
          maxLength={STATUS_TEXT_MAX}
          className="input-navy mt-1.5 w-full resize-none rounded-lg px-4 py-3 text-sm"
          placeholder="What's true for you right now?"
        />
        <span className="mt-1 block text-right text-xs text-white/40">
          {statusText.length}/{STATUS_TEXT_MAX}
        </span>
      </label>

      <div className="space-y-3 border-t border-white/10 pt-5">
        <label className="flex items-center gap-3 text-sm text-white/80">
          <input
            type="checkbox"
            checked={includeOpp}
            onChange={(e) => setIncludeOpp(e.target.checked)}
            className="h-4 w-4 rounded border-white/30 accent-electric"
          />
          Add a first opportunity (optional)
        </label>
        {includeOpp ? (
          <div className="grid gap-3">
            <input
              value={opp.title}
              onChange={(e) => setOpp((o) => ({ ...o, title: e.target.value }))}
              placeholder="Title"
              className="input-navy h-11 rounded-lg px-4 text-sm"
            />
            <textarea
              value={opp.description}
              onChange={(e) =>
                setOpp((o) => ({ ...o, description: e.target.value }))
              }
              placeholder="Description"
              rows={3}
              className="input-navy w-full resize-y rounded-lg px-4 py-3 text-sm"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={opp.city}
                onChange={(e) =>
                  setOpp((o) => ({ ...o, city: e.target.value }))
                }
                placeholder="City"
                className="input-navy h-11 rounded-lg px-4 text-sm"
              />
              <input
                value={opp.country}
                onChange={(e) =>
                  setOpp((o) => ({ ...o, country: e.target.value }))
                }
                placeholder="Country"
                className="input-navy h-11 rounded-lg px-4 text-sm"
              />
            </div>
            <select
              value={opp.category}
              onChange={(e) =>
                setOpp((o) => ({ ...o, category: e.target.value }))
              }
              className="input-navy h-11 rounded-lg px-4 text-sm"
            >
              <option value="">Select category</option>
              {categories.map((cat) => (
                <option key={cat.slug || cat.name} value={cat.name}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <PrimaryButton type="submit" showArrow={false} disabled={submitting}>
        {submitting ? "Finishing…" : "Finish"}
      </PrimaryButton>
    </form>
  );
}
