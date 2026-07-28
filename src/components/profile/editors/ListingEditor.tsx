"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ListingImageManager } from "@/components/media/ListingImageManager";
import { useAppUi } from "@/components/providers/AppProviders";
import {
  CLOTHING_CATEGORIES,
  CLOTHING_CONDITIONS,
  CLOTHING_FITS,
  CLOTHING_GENDERS,
  CLOTHING_SIZES,
} from "@/lib/clothing";
import type { Listing, ListingAvailability } from "@/lib/types";
import {
  EditorField,
  EditorShell,
  EditorSubmit,
  apiJson,
  editorInputClass,
  jsonBody,
} from "@/components/profile/editors/EditorShell";

type ListingEditorProps = {
  onClose: () => void;
  listingId?: string | null;
};

type ListingForm = {
  name: string;
  category: string;
  subcategory: string;
  material: string;
  brand: string;
  condition: string;
  colour: string;
  pattern: string;
  fit: string;
  gender: string;
  sizes: string[];
  shippingAvailable: boolean;
  shipFromCity: string;
  shipFromCountry: string;
  price: string;
  description: string;
  availability: ListingAvailability;
  saleStatus: "AVAILABLE" | "RESERVED" | "SOLD" | "ARCHIVED";
  images: string[];
};

const blank: ListingForm = {
  name: "",
  category: "",
  subcategory: "",
  material: "",
  brand: "",
  condition: "",
  colour: "",
  pattern: "",
  fit: "",
  gender: "",
  sizes: [],
  shippingAvailable: false,
  shipFromCity: "",
  shipFromCountry: "",
  price: "",
  description: "",
  availability: "available",
  saleStatus: "AVAILABLE",
  images: [],
};

function fromListing(item: Listing): ListingForm {
  const sale = (item.saleStatus || "AVAILABLE").toUpperCase();
  const saleStatus =
    sale === "RESERVED" || sale === "SOLD" || sale === "ARCHIVED"
      ? sale
      : "AVAILABLE";
  return {
    name: item.name || "",
    category: item.category || "",
    subcategory: item.subcategory || "",
    material: item.material || "",
    brand: item.brand || "",
    condition: item.condition || "",
    colour: item.colour || "",
    pattern: item.pattern || "",
    fit: item.fit || "",
    gender: item.gender || "",
    sizes: item.sizes || [],
    shippingAvailable: Boolean(item.shippingAvailable),
    shipFromCity: item.shipFromCity || "",
    shipFromCountry: item.shipFromCountry || "",
    price: item.price != null ? String(item.price) : "",
    description: item.description || "",
    availability: item.availability || "available",
    saleStatus,
    images: (item.images || []).filter((x) => !x.includes("/placeholders/")),
  };
}

export function ListingEditor({ onClose, listingId }: ListingEditorProps) {
  const router = useRouter();
  const { account, showToast } = useAppUi();
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(listingId));

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson("/api/stock");
        const row = (data.listings || []).find(
          (l: Listing) => l.id === listingId,
        );
        if (row && !cancelled) setForm(fromListing(row));
      } catch (err) {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : "Failed to load listing");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId, showToast]);

  function toggleSize(size: string) {
    setForm((f) => ({
      ...f,
      sizes: f.sizes.includes(size)
        ? f.sizes.filter((s) => s !== size)
        : [...f.sizes, size],
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.images.length) {
      showToast("Add at least one image");
      return;
    }
    if (!form.sizes.length) {
      showToast("Select at least one size");
      return;
    }
    const price = Number(form.price);
    if (!Number.isFinite(price) || price < 0) {
      showToast("Enter a valid price");
      return;
    }

    setBusy(true);
    try {
      const payload = {
        name: form.name.trim() || form.category,
        productKind: "clothing" as const,
        category: form.category,
        subcategory: form.subcategory.trim(),
        material: form.material.trim(),
        brand: form.brand.trim(),
        condition: form.condition,
        colour: form.colour.trim(),
        pattern: form.pattern.trim(),
        fit: form.fit,
        gender: form.gender,
        sizes: form.sizes,
        shippingAvailable: form.shippingAvailable,
        shipFromCity: form.shipFromCity.trim(),
        shipFromCountry: form.shipFromCountry.trim(),
        price,
        description: form.description.trim(),
        availability: form.availability,
        saleStatus: form.saleStatus,
        images: form.images,
      };
      if (listingId) {
        await apiJson(`/api/stock/${listingId}`, jsonBody("PATCH", payload));
      } else {
        await apiJson("/api/stock", jsonBody("POST", payload));
      }
      showToast(listingId ? "Listing updated" : "Listing created");
      onClose();
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save listing");
    } finally {
      setBusy(false);
    }
  }

  if (!account) {
    return (
      <EditorShell title="Manage Listing" onClose={onClose}>
        <p className="text-sm text-white/45">Sign in to manage listings.</p>
      </EditorShell>
    );
  }

  return (
    <EditorShell
      title={listingId ? "Edit Listing" : "Post Listing"}
      onClose={onClose}
      wide
    >
      {loading ? (
        <p className="text-sm text-white/45">Loading…</p>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <EditorField label="Name">
            <input
              className={editorInputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Optional product name"
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
              {CLOTHING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </EditorField>
          <EditorField label="Subcategory">
            <input
              className={editorInputClass}
              value={form.subcategory}
              onChange={(e) =>
                setForm({ ...form, subcategory: e.target.value })
              }
            />
          </EditorField>
          <EditorField label="Material">
            <input
              className={editorInputClass}
              value={form.material}
              onChange={(e) => setForm({ ...form, material: e.target.value })}
            />
          </EditorField>
          <EditorField label="Brand">
            <input
              className={editorInputClass}
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
            />
          </EditorField>
          <EditorField label="Condition">
            <select
              className={editorInputClass}
              value={form.condition}
              onChange={(e) => setForm({ ...form, condition: e.target.value })}
            >
              <option value="">Select condition</option>
              {CLOTHING_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </EditorField>
          <EditorField label="Colour">
            <input
              className={editorInputClass}
              value={form.colour}
              onChange={(e) => setForm({ ...form, colour: e.target.value })}
            />
          </EditorField>
          <EditorField label="Pattern">
            <input
              className={editorInputClass}
              value={form.pattern}
              onChange={(e) => setForm({ ...form, pattern: e.target.value })}
            />
          </EditorField>
          <EditorField label="Fit">
            <select
              className={editorInputClass}
              value={form.fit}
              onChange={(e) => setForm({ ...form, fit: e.target.value })}
            >
              <option value="">Select fit</option>
              {CLOTHING_FITS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </EditorField>
          <EditorField label="Gender">
            <select
              className={editorInputClass}
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value })}
            >
              <option value="">Select gender</option>
              {CLOTHING_GENDERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </EditorField>

          <div className="sm:col-span-2">
            <p className="mb-2 text-xs text-white/45">Sizes</p>
            <div className="flex flex-wrap gap-2">
              {CLOTHING_SIZES.map((size) => {
                const checked = form.sizes.includes(size);
                return (
                  <label
                    key={size}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                      checked
                        ? "border-electric/50 bg-electric/15 text-electric"
                        : "border-white/15 text-white/70 hover:border-white/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => toggleSize(size)}
                    />
                    {size}
                  </label>
                );
              })}
            </div>
          </div>

          <EditorField label="Price (USD)">
            <input
              type="number"
              min="0"
              step="0.01"
              className={editorInputClass}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              required
            />
          </EditorField>
          <EditorField label="Availability">
            <select
              className={editorInputClass}
              value={form.availability}
              onChange={(e) =>
                setForm({
                  ...form,
                  availability: e.target.value as ListingAvailability,
                })
              }
              required
            >
              <option value="available">Available</option>
              <option value="limited">Limited</option>
              <option value="made_to_order">Made to order</option>
              <option value="to_source">Available to source</option>
            </select>
          </EditorField>
          <EditorField label="Sale status">
            <select
              className={editorInputClass}
              value={form.saleStatus}
              onChange={(e) =>
                setForm({
                  ...form,
                  saleStatus: e.target.value as ListingForm["saleStatus"],
                })
              }
              required
            >
              <option value="AVAILABLE">Available</option>
              <option value="RESERVED">Reserved</option>
              <option value="SOLD">Sold</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </EditorField>
          <EditorField label="Shipped from (city)">
            <input
              className={editorInputClass}
              value={form.shipFromCity}
              onChange={(e) =>
                setForm({ ...form, shipFromCity: e.target.value })
              }
              required
            />
          </EditorField>
          <EditorField label="Shipped from (country)">
            <input
              className={editorInputClass}
              value={form.shipFromCountry}
              onChange={(e) =>
                setForm({ ...form, shipFromCountry: e.target.value })
              }
              required
            />
          </EditorField>

          <label className="flex items-center gap-3 text-sm text-white/70 sm:col-span-2">
            <input
              type="checkbox"
              checked={form.shippingAvailable}
              onChange={(e) =>
                setForm({ ...form, shippingAvailable: e.target.checked })
              }
              className="h-4 w-4 rounded border-white/30 bg-transparent"
            />
            Shipping available
          </label>

          <div className="sm:col-span-2">
            <EditorField label="Description">
              <textarea
                className={`${editorInputClass} min-h-28 py-3`}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                required
                maxLength={4000}
              />
            </EditorField>
          </div>

          <div className="sm:col-span-2">
            <p className="mb-2 text-xs text-white/45">Images</p>
            <ListingImageManager
              userId={account.id}
              images={form.images}
              onChange={(images) => setForm({ ...form, images })}
              showToast={showToast}
              maxImages={6}
              disabled={busy}
            />
          </div>

          <div className="sm:col-span-2">
            <EditorSubmit busy={busy}>
              {listingId ? "Save listing" : "Create listing"}
            </EditorSubmit>
          </div>
        </form>
      )}
    </EditorShell>
  );
}
