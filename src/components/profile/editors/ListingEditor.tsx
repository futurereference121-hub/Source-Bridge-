"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ListingImageManager } from "@/components/media/ListingImageManager";
import { useAppUi } from "@/components/providers/AppProviders";
import {
  CLOTHING_CATEGORIES,
  CLOTHING_CONDITIONS,
  CLOTHING_FITS,
  CLOTHING_GENDERS,
  CLOTHING_SIZES,
  PRODUCT_KINDS,
  type ProductKind,
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
  /** After save / cancel edit: stay in listing UI but switch to blank create mode. */
  onReturnToCreate?: () => void;
  listingId?: string | null;
};

type ListingForm = {
  name: string;
  productKind: ProductKind;
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
  productKind: "clothing",
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
  const kind =
    item.productKind === "general" ? "general" : ("clothing" as ProductKind);
  return {
    name: item.name || "",
    productKind: kind,
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

export function ListingEditor({
  onClose,
  onReturnToCreate,
  listingId,
}: ListingEditorProps) {
  const router = useRouter();
  const { account, showToast } = useAppUi();
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [imagesUploading, setImagesUploading] = useState(false);
  const [loading, setLoading] = useState(Boolean(listingId));
  const [generalCategories, setGeneralCategories] = useState<string[]>([]);
  const isEdit = Boolean(listingId);

  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson("/api/categories");
        const names = (data.categories || [])
          .map((c: { name?: string }) => c.name)
          .filter((n: unknown): n is string => typeof n === "string" && n.trim().length > 0);
        if (!cancelled) setGeneralCategories(names);
      } catch {
        /* clothing editor still works without this list */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!listingId) {
      setForm(blank);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await apiJson("/api/stock");
        const row = (data.listings || []).find(
          (l: Listing) => l.id === listingId,
        );
        if (!cancelled) {
          if (row) setForm(fromListing(row));
          else {
            showToastRef.current("Listing not found");
            setForm(blank);
          }
        }
      } catch (err) {
        if (!cancelled) {
          showToastRef.current(
            err instanceof Error ? err.message : "Failed to load listing",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  function resetToCreate() {
    setForm(blank);
    setImagesUploading(false);
    setBusy(false);
    setLoading(false);
  }

  function returnToCreateMode() {
    resetToCreate();
    if (onReturnToCreate) onReturnToCreate();
    else onClose();
  }

  function cancelEdit() {
    if (isEdit) returnToCreateMode();
    else {
      resetToCreate();
      onClose();
    }
  }

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
    if (busy || imagesUploading) return;
    if (imagesUploading) {
      showToast("Wait for image uploads to finish before saving");
      return;
    }
    if (!form.images.length) {
      showToast("Add at least one image");
      return;
    }
    if (form.images.some((url) => url.startsWith("blob:"))) {
      showToast("Images are still uploading — wait for permanent URLs");
      return;
    }
    if (form.productKind === "clothing" && !form.sizes.length) {
      showToast("Select at least one size");
      return;
    }
    if (!form.category.trim()) {
      showToast("Select a category");
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
        productKind: form.productKind,
        category: form.category,
        subcategory: form.subcategory.trim(),
        material: form.material.trim(),
        brand: form.brand.trim(),
        condition: form.condition,
        colour: form.colour.trim(),
        pattern: form.pattern.trim(),
        fit: form.fit,
        gender: form.gender,
        sizes: form.productKind === "clothing" ? form.sizes : [],
        shippingAvailable: form.shippingAvailable,
        shipFromCity: form.shipFromCity.trim(),
        shipFromCountry: form.shipFromCountry.trim(),
        price,
        description: form.description.trim(),
        availability: form.availability,
        saleStatus: form.saleStatus,
        images: form.images.slice(0, 12),
      };
      if (listingId) {
        await apiJson(`/api/stock/${listingId}`, jsonBody("PATCH", payload));
        showToast("Product updated successfully.");
        resetToCreate();
        router.refresh();
        returnToCreateMode();
      } else {
        await apiJson("/api/stock", jsonBody("POST", payload));
        showToast("Product added successfully.");
        resetToCreate();
        router.refresh();
      }
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

  const title = isEdit
    ? `Edit Listing: ${form.name || "Untitled"}`
    : "Create New Listing";

  const categoryOptions =
    form.productKind === "clothing"
      ? [...CLOTHING_CATEGORIES]
      : generalCategories.length
        ? generalCategories
        : ["Jewellery", "Home & Living", "Collectibles", "Clothing"];

  return (
    <EditorShell title={title} onClose={isEdit ? cancelEdit : onClose} wide>
      {loading ? (
        <p className="text-sm text-white/45">Loading…</p>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <p className="sm:col-span-2 text-xs text-white/45">
            {isEdit
              ? "Update this listing, then Save Changes. Cancel Edit discards unsaved changes."
              : "Fill in the fields below to add a new listing."}
          </p>

          <EditorField label="Product type">
            <select
              className={editorInputClass}
              value={form.productKind}
              onChange={(e) => {
                const productKind = e.target.value as ProductKind;
                setForm((f) => ({
                  ...f,
                  productKind,
                  category: "",
                  sizes: productKind === "clothing" ? f.sizes : [],
                }));
              }}
              required
              disabled={busy}
            >
              {PRODUCT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k === "clothing" ? "Clothing" : "General"}
                </option>
              ))}
            </select>
          </EditorField>

          <EditorField label="Name">
            <input
              className={editorInputClass}
              value={form.name}
              onChange={(e) =>
                setForm((f) => ({ ...f, name: e.target.value }))
              }
              placeholder="Optional product name"
              disabled={busy}
            />
          </EditorField>
          <EditorField label="Category">
            <select
              className={editorInputClass}
              value={form.category}
              onChange={(e) =>
                setForm((f) => ({ ...f, category: e.target.value }))
              }
              required
              disabled={busy}
            >
              <option value="">Select category</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {form.category &&
              !categoryOptions.some(
                (c) => c.toLowerCase() === form.category.toLowerCase(),
              ) ? (
                <option value={form.category}>{form.category}</option>
              ) : null}
            </select>
          </EditorField>
          <EditorField label="Subcategory">
            <input
              className={editorInputClass}
              value={form.subcategory}
              onChange={(e) =>
                setForm((f) => ({ ...f, subcategory: e.target.value }))
              }
              disabled={busy}
            />
          </EditorField>
          <EditorField label="Material">
            <input
              className={editorInputClass}
              value={form.material}
              onChange={(e) =>
                setForm((f) => ({ ...f, material: e.target.value }))
              }
              disabled={busy}
            />
          </EditorField>
          <EditorField label="Brand">
            <input
              className={editorInputClass}
              value={form.brand}
              onChange={(e) =>
                setForm((f) => ({ ...f, brand: e.target.value }))
              }
              disabled={busy}
            />
          </EditorField>
          <EditorField label="Condition">
            <select
              className={editorInputClass}
              value={form.condition}
              onChange={(e) =>
                setForm((f) => ({ ...f, condition: e.target.value }))
              }
              disabled={busy}
            >
              <option value="">Select condition</option>
              {CLOTHING_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {form.condition &&
              !CLOTHING_CONDITIONS.includes(
                form.condition as (typeof CLOTHING_CONDITIONS)[number],
              ) ? (
                <option value={form.condition}>{form.condition}</option>
              ) : null}
            </select>
          </EditorField>
          <EditorField label="Colour">
            <input
              className={editorInputClass}
              value={form.colour}
              onChange={(e) =>
                setForm((f) => ({ ...f, colour: e.target.value }))
              }
              disabled={busy}
            />
          </EditorField>
          <EditorField label="Pattern">
            <input
              className={editorInputClass}
              value={form.pattern}
              onChange={(e) =>
                setForm((f) => ({ ...f, pattern: e.target.value }))
              }
              disabled={busy}
            />
          </EditorField>
          {form.productKind === "clothing" ? (
            <>
              <EditorField label="Fit">
                <select
                  className={editorInputClass}
                  value={form.fit}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, fit: e.target.value }))
                  }
                  disabled={busy}
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
                  onChange={(e) =>
                    setForm((f) => ({ ...f, gender: e.target.value }))
                  }
                  disabled={busy}
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
                          disabled={busy}
                        />
                        {size}
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}

          <EditorField label="Price">
            <input
              type="number"
              min="0"
              step="0.01"
              className={editorInputClass}
              value={form.price}
              onChange={(e) =>
                setForm((f) => ({ ...f, price: e.target.value }))
              }
              required
              disabled={busy}
            />
          </EditorField>
          <EditorField label="Availability">
            <select
              className={editorInputClass}
              value={form.availability}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  availability: e.target.value as ListingAvailability,
                }))
              }
              required
              disabled={busy}
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
                setForm((f) => ({
                  ...f,
                  saleStatus: e.target.value as ListingForm["saleStatus"],
                }))
              }
              required
              disabled={busy}
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
                setForm((f) => ({ ...f, shipFromCity: e.target.value }))
              }
              required
              disabled={busy}
            />
          </EditorField>
          <EditorField label="Shipped from (country)">
            <input
              className={editorInputClass}
              value={form.shipFromCountry}
              onChange={(e) =>
                setForm((f) => ({ ...f, shipFromCountry: e.target.value }))
              }
              required
              disabled={busy}
            />
          </EditorField>

          <label className="flex items-center gap-3 text-sm text-white/70 sm:col-span-2">
            <input
              type="checkbox"
              checked={form.shippingAvailable}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  shippingAvailable: e.target.checked,
                }))
              }
              className="h-4 w-4 rounded border-white/30 bg-transparent"
              disabled={busy}
            />
            Shipping available
          </label>

          <div className="sm:col-span-2">
            <EditorField label="Description">
              <textarea
                className={`${editorInputClass} min-h-28 py-3`}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                required
                maxLength={4000}
                disabled={busy}
              />
            </EditorField>
          </div>

          <div className="sm:col-span-2">
            <p className="mb-2 text-xs text-white/45">Images</p>
            <ListingImageManager
              userId={account.id}
              images={form.images}
              onChange={(images) =>
                setForm((f) => ({ ...f, images }))
              }
              onUploadingChange={setImagesUploading}
              showToast={showToast}
              maxImages={12}
              disabled={busy}
            />
            {imagesUploading ? (
              <p className="mt-2 text-xs text-amber-200/90">
                Images are still uploading — save is disabled until they finish.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <EditorSubmit busy={busy || imagesUploading}>
              {isEdit ? "Save Changes" : "Add Product"}
            </EditorSubmit>
            {isEdit ? (
              <button
                type="button"
                onClick={cancelEdit}
                disabled={busy}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-white/20 px-5 text-xs font-medium uppercase tracking-[0.12em] text-white/80 transition-colors hover:border-white/40 hover:text-white disabled:opacity-50"
              >
                Cancel Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-white/20 px-5 text-xs font-medium uppercase tracking-[0.12em] text-white/80 transition-colors hover:border-white/40 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </EditorShell>
  );
}
