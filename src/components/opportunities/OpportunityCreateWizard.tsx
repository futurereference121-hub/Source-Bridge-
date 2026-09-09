"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  CREATABLE_OPPORTUNITY_KINDS,
  OPPORTUNITY_KIND_LABELS,
  type CreatableOpportunityKind,
} from "@/lib/opportunities/kinds";
import { emitOpportunityChanged } from "@/lib/opportunity-surface-sync";
import {
  uploadProfileImageFile,
  validateImageFileClient,
} from "@/lib/client-image-upload";
import { IMAGE_ACCEPT_ATTR } from "@/lib/storage-constants";
import { useAppUi } from "@/components/providers/AppProviders";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  /** Prefill travel from private Trip data (not public UI). */
  travelPrefill?: {
    destinationCity?: string;
    destinationCountry?: string;
    travelStartAt?: string;
    travelEndAt?: string;
  };
};

const DRAFT_KEY = "sb_opportunity_draft_v1";

function newClientRequestId() {
  return `opp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function toIsoDateStart(d: string) {
  if (!d) return null;
  return new Date(`${d}T00:00:00.000Z`).toISOString();
}
function toIsoDateEnd(d: string) {
  if (!d) return null;
  return new Date(`${d}T23:59:59.000Z`).toISOString();
}

export function OpportunityCreateWizard({
  open,
  onClose,
  onCreated,
  travelPrefill,
}: Props) {
  const { showToast, requireAuth, account } = useAppUi();
  const [kind, setKind] = useState<CreatableOpportunityKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [clientRequestId] = useState(() => newClientRequestId());

  const [form, setForm] = useState({
    title: "",
    description: "",
    sourceCity: "",
    sourceCountry: "",
    deliveryCity: "",
    deliveryCountry: "",
    destinationCity: travelPrefill?.destinationCity || "",
    destinationCountry: travelPrefill?.destinationCountry || "",
    originCity: "",
    originCountry: "",
    travelStart: travelPrefill?.travelStartAt?.slice(0, 10) || "",
    travelEnd: travelPrefill?.travelEndAt?.slice(0, 10) || "",
    deadline: "",
    availabilityEnds: "",
    category: "",
    quantity: "",
    budgetMin: "",
    budgetMax: "",
    budgetCurrency: "USD",
    deliveryMode: "" as "" | "SHIP" | "HAND" | "EITHER",
    alternativesOk: false,
    internationalShipping: false,
    localHandover: true,
    canShip: false,
    canHandDeliver: true,
    specialistDetails: "",
    sizeLimits: "",
    luggageRestrictions: "",
    notes: "",
  });

  const kindLabel = kind ? OPPORTUNITY_KIND_LABELS[kind] : "";

  const draftHint = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      return sessionStorage.getItem(DRAFT_KEY);
    } catch {
      return null;
    }
  }, []);

  if (!open) return null;

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    if (!account?.id) {
      showToast("Sign in to upload photos");
      return;
    }
    for (const file of Array.from(files).slice(0, 6 - photos.length)) {
      const err = validateImageFileClient(file);
      if (err) {
        showToast(err);
        continue;
      }
      try {
        const result = await uploadProfileImageFile({
          file,
          folder: "misc",
          kind: "stock",
          userId: account.id,
        });
        if (result.url) {
          setPhotos((p) => [...p, result.url].slice(0, 6));
        }
      } catch (uploadErr) {
        showToast(
          uploadErr instanceof Error ? uploadErr.message : "Upload failed",
        );
      }
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!kind) return;
    if (!requireAuth("post an opportunity")) return;
    setBusy(true);
    setError("");
    try {
      let payload: Record<string, unknown>;
      if (kind === "BUYER_REQUEST") {
        payload = {
          kind,
          title: form.title.trim(),
          description: form.description.trim(),
          sourceCity: form.sourceCity.trim(),
          sourceCountry: form.sourceCountry.trim(),
          deliveryCity: form.deliveryCity.trim(),
          deliveryCountry: form.deliveryCountry.trim(),
          category: form.category.trim(),
          categories: form.category.trim() ? [form.category.trim()] : [],
          photos,
          quantity: form.quantity.trim(),
          budget: {
            minMinor: form.budgetMin
              ? Math.round(Number(form.budgetMin) * 100)
              : null,
            maxMinor: form.budgetMax
              ? Math.round(Number(form.budgetMax) * 100)
              : null,
            currency: form.budgetCurrency.trim(),
          },
          deadline: toIsoDateEnd(form.deadline),
          alternativesOk: form.alternativesOk,
          deliveryMode: form.deliveryMode,
          notes: form.notes.trim(),
          clientRequestId,
        };
      } else if (kind === "SOURCING_OFFER") {
        payload = {
          kind,
          title: form.title.trim(),
          description: form.description.trim(),
          sourceCity: form.sourceCity.trim(),
          sourceCountry: form.sourceCountry.trim(),
          categories: form.category.trim() ? [form.category.trim()] : [],
          photos,
          availabilityEndsAt: toIsoDateEnd(form.availabilityEnds),
          internationalShipping: form.internationalShipping,
          localHandover: form.localHandover,
          specialistDetails: form.specialistDetails.trim(),
          sizeLimits: form.sizeLimits.trim(),
          notes: form.notes.trim(),
          clientRequestId,
        };
      } else {
        payload = {
          kind,
          title: form.title.trim(),
          description: form.description.trim(),
          destinationCity: form.destinationCity.trim(),
          destinationCountry: form.destinationCountry.trim(),
          travelStartAt: toIsoDateStart(form.travelStart),
          travelEndAt: toIsoDateEnd(form.travelEnd),
          originCity: form.originCity.trim(),
          originCountry: form.originCountry.trim(),
          categories: form.category.trim() ? [form.category.trim()] : [],
          photos,
          canShip: form.canShip,
          canHandDeliver: form.canHandDeliver,
          luggageRestrictions: form.luggageRestrictions.trim(),
          notes: form.notes.trim(),
          clientRequestId,
        };
      }

      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ kind, form }));
      } catch {
        /* ignore */
      }

      const res = await fetch("/api/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not create opportunity");
      }
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      emitOpportunityChanged({
        opportunity: data.opportunity,
        version: Date.parse(data.opportunity?.postedAt || "") || Date.now(),
      });
      showToast("Opportunity posted");
      onCreated?.();
      onClose();
      setKind(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-lg border border-white/15 bg-transparent px-3 py-2.5 text-sm text-white outline-none focus:border-electric/50";

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/65"
        aria-label="Close create opportunity"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create opportunity"
        className="relative z-[86] flex max-h-[min(94svh,960px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-white/12 bg-[#0b1220] sm:rounded-2xl"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-medium text-white">
            {kind ? kindLabel : "New opportunity"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-3 text-xs uppercase tracking-wider text-white/60"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {!kind ? (
            <div className="space-y-3">
              <p className="text-sm text-white/60">
                Choose what you want to post. This is not a payment or Live
                session.
              </p>
              {draftHint ? (
                <p className="text-xs text-amber-200/80">
                  A local draft from this session may still be available after
                  you pick a type.
                </p>
              ) : null}
              {CREATABLE_OPPORTUNITY_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className="flex w-full flex-col rounded-xl border border-white/12 bg-white/[0.03] px-4 py-3 text-left hover:border-electric/40"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200">
                    {OPPORTUNITY_KIND_LABELS[k]}
                  </span>
                  <span className="mt-1 text-sm text-white/70">
                    {k === "BUYER_REQUEST"
                      ? "I'm looking for something"
                      : k === "SOURCING_OFFER"
                        ? "I can source something"
                        : "I'm travelling somewhere"}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              <button
                type="button"
                className="text-xs text-electric"
                onClick={() => setKind(null)}
              >
                ← Change type
              </button>

              {kind !== "TRAVEL_OPPORTUNITY" ? (
                <>
                  <Field label="Title">
                    <input
                      className={input}
                      value={form.title}
                      onChange={(e) =>
                        setForm({ ...form, title: e.target.value })
                      }
                      required
                      maxLength={120}
                    />
                  </Field>
                  <Field label="Description">
                    <textarea
                      className={`${input} min-h-24`}
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                      required
                      maxLength={2000}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Title (optional)">
                    <input
                      className={input}
                      value={form.title}
                      onChange={(e) =>
                        setForm({ ...form, title: e.target.value })
                      }
                      maxLength={120}
                    />
                  </Field>
                  <Field label="Description (optional)">
                    <textarea
                      className={`${input} min-h-20`}
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                      maxLength={2000}
                    />
                  </Field>
                </>
              )}

              {kind === "BUYER_REQUEST" || kind === "SOURCING_OFFER" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Field label={kind === "BUYER_REQUEST" ? "Desired source city" : "Sourcing city"}>
                    <input
                      className={input}
                      value={form.sourceCity}
                      onChange={(e) =>
                        setForm({ ...form, sourceCity: e.target.value })
                      }
                      required
                    />
                  </Field>
                  <Field label="Country">
                    <input
                      className={input}
                      value={form.sourceCountry}
                      onChange={(e) =>
                        setForm({ ...form, sourceCountry: e.target.value })
                      }
                      required
                    />
                  </Field>
                </div>
              ) : null}

              {kind === "BUYER_REQUEST" ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Delivery city">
                      <input
                        className={input}
                        value={form.deliveryCity}
                        onChange={(e) =>
                          setForm({ ...form, deliveryCity: e.target.value })
                        }
                        required
                      />
                    </Field>
                    <Field label="Delivery country">
                      <input
                        className={input}
                        value={form.deliveryCountry}
                        onChange={(e) =>
                          setForm({ ...form, deliveryCountry: e.target.value })
                        }
                        required
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Budget min">
                      <input
                        className={input}
                        inputMode="decimal"
                        value={form.budgetMin}
                        onChange={(e) =>
                          setForm({ ...form, budgetMin: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Budget max">
                      <input
                        className={input}
                        inputMode="decimal"
                        value={form.budgetMax}
                        onChange={(e) =>
                          setForm({ ...form, budgetMax: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Currency">
                      <input
                        className={input}
                        value={form.budgetCurrency}
                        onChange={(e) =>
                          setForm({ ...form, budgetCurrency: e.target.value })
                        }
                        maxLength={8}
                      />
                    </Field>
                  </div>
                  <p className="text-[11px] text-white/40">
                    Budget is informational only — it does not create a payment
                    or fee.
                  </p>
                  <Field label="Deadline (optional)">
                    <input
                      type="date"
                      className={input}
                      value={form.deadline}
                      onChange={(e) =>
                        setForm({ ...form, deadline: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Delivery preference">
                    <select
                      className={input}
                      value={form.deliveryMode}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          deliveryMode: e.target.value as typeof form.deliveryMode,
                        })
                      }
                    >
                      <option value="">Either / not sure</option>
                      <option value="SHIP">Shipping</option>
                      <option value="HAND">Hand handover</option>
                      <option value="EITHER">Either</option>
                    </select>
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={form.alternativesOk}
                      onChange={(e) =>
                        setForm({ ...form, alternativesOk: e.target.checked })
                      }
                    />
                    Alternatives OK
                  </label>
                </>
              ) : null}

              {kind === "SOURCING_OFFER" ? (
                <>
                  <Field label="Availability ends (optional)">
                    <input
                      type="date"
                      className={input}
                      value={form.availabilityEnds}
                      onChange={(e) =>
                        setForm({ ...form, availabilityEnds: e.target.value })
                      }
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={form.internationalShipping}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          internationalShipping: e.target.checked,
                        })
                      }
                    />
                    International shipping
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={form.localHandover}
                      onChange={(e) =>
                        setForm({ ...form, localHandover: e.target.checked })
                      }
                    />
                    Local handover
                  </label>
                  <Field label="Specialist details">
                    <textarea
                      className={`${input} min-h-16`}
                      value={form.specialistDetails}
                      onChange={(e) =>
                        setForm({ ...form, specialistDetails: e.target.value })
                      }
                    />
                  </Field>
                </>
              ) : null}

              {kind === "TRAVEL_OPPORTUNITY" ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Destination city">
                      <input
                        className={input}
                        value={form.destinationCity}
                        onChange={(e) =>
                          setForm({ ...form, destinationCity: e.target.value })
                        }
                        required
                      />
                    </Field>
                    <Field label="Destination country">
                      <input
                        className={input}
                        value={form.destinationCountry}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            destinationCountry: e.target.value,
                          })
                        }
                        required
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Travel start">
                      <input
                        type="date"
                        className={input}
                        value={form.travelStart}
                        onChange={(e) =>
                          setForm({ ...form, travelStart: e.target.value })
                        }
                        required
                      />
                    </Field>
                    <Field label="Travel end">
                      <input
                        type="date"
                        className={input}
                        value={form.travelEnd}
                        onChange={(e) =>
                          setForm({ ...form, travelEnd: e.target.value })
                        }
                        required
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Origin city (optional)">
                      <input
                        className={input}
                        value={form.originCity}
                        onChange={(e) =>
                          setForm({ ...form, originCity: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Origin country">
                      <input
                        className={input}
                        value={form.originCountry}
                        onChange={(e) =>
                          setForm({ ...form, originCountry: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={form.canShip}
                      onChange={(e) =>
                        setForm({ ...form, canShip: e.target.checked })
                      }
                    />
                    Can ship
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={form.canHandDeliver}
                      onChange={(e) =>
                        setForm({ ...form, canHandDeliver: e.target.checked })
                      }
                    />
                    Can hand-deliver
                  </label>
                  <Field label="Luggage restrictions">
                    <input
                      className={input}
                      value={form.luggageRestrictions}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          luggageRestrictions: e.target.value,
                        })
                      }
                    />
                  </Field>
                </>
              ) : null}

              <Field label="Category (optional)">
                <input
                  className={input}
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                />
              </Field>
              <Field label="Notes (optional)">
                <textarea
                  className={`${input} min-h-16`}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </Field>
              <Field label="Photos (optional)">
                <input
                  type="file"
                  accept={IMAGE_ACCEPT_ATTR}
                  multiple
                  onChange={(e) => void onUpload(e.target.files)}
                />
                {photos.length ? (
                  <p className="mt-1 text-xs text-white/45">
                    {photos.length} photo{photos.length === 1 ? "" : "s"} attached
                  </p>
                ) : null}
              </Field>

              {error ? (
                <p className="text-sm text-red-300" role="alert">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-lg bg-electric px-4 text-xs font-semibold uppercase tracking-[0.14em] text-navy disabled:opacity-50"
              >
                {busy ? "Posting…" : "Post opportunity"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.14em] text-white/45">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
