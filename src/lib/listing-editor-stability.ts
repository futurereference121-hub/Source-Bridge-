/**
 * Pure helpers for product create/edit stability.
 * Used by ListingEditor and regression tests — keep free of React/DOM.
 */

export type ListingEditorMode = "create" | "edit";

export function listingEditorMode(listingId: string | null | undefined): ListingEditorMode {
  return listingId ? "edit" : "create";
}

export function listingEditorHeading(
  mode: ListingEditorMode,
  productTitle?: string,
): string {
  if (mode === "edit") {
    const title = (productTitle || "").trim();
    return title ? `Edit Listing: ${title}` : "Edit Listing";
  }
  return "Create New Listing";
}

export function listingEditorPrimaryLabel(mode: ListingEditorMode): string {
  return mode === "edit" ? "Save Changes" : "Create Listing";
}

/** Serialize form snapshot for dirty detection (order-stable). */
export function serializeListingFormSnapshot(form: {
  name: string;
  productKind: string;
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
  availability: string;
  saleStatus: string;
  images: string[];
  protectedPaymentEnabled?: boolean;
  directPaymentEnabled?: boolean;
}): string {
  return JSON.stringify({
    name: form.name,
    productKind: form.productKind,
    category: form.category,
    subcategory: form.subcategory,
    material: form.material,
    brand: form.brand,
    condition: form.condition,
    colour: form.colour,
    pattern: form.pattern,
    fit: form.fit,
    gender: form.gender,
    sizes: [...form.sizes].sort(),
    shippingAvailable: form.shippingAvailable,
    shipFromCity: form.shipFromCity,
    shipFromCountry: form.shipFromCountry,
    price: form.price,
    description: form.description,
    availability: form.availability,
    saleStatus: form.saleStatus,
    images: form.images,
    protectedPaymentEnabled: Boolean(form.protectedPaymentEnabled),
    directPaymentEnabled: Boolean(form.directPaymentEnabled),
  });
}

export function isListingFormDirty(
  baseline: string | null | undefined,
  current: string,
): boolean {
  if (!baseline) return false;
  return baseline !== current;
}

/**
 * Backdrop / outside clicks must never close the product editor.
 * Only intentional Close, Cancel Edit, successful save, or confirmed discard.
 */
export function shouldCloseListingEditorOnBackdrop(): boolean {
  return false;
}

export function shouldCloseListingEditorOnMouseLeave(): boolean {
  return false;
}

export function shouldCloseListingEditorOnBlur(): boolean {
  return false;
}

export function shouldCloseListingEditorOnListRefresh(): boolean {
  return false;
}

export function shouldCloseListingEditorOnImageInteraction(): boolean {
  return false;
}

export type DiscardDecision = "keep_editing" | "discard" | "not_dirty";

/**
 * Map confirm() result: OK → discard, Cancel → keep editing.
 * When not dirty, skip confirmation.
 */
export function resolveDiscardDecision(
  dirty: boolean,
  userConfirmedDiscard: boolean | null,
): DiscardDecision {
  if (!dirty) return "not_dirty";
  if (userConfirmedDiscard === true) return "discard";
  return "keep_editing";
}

export const DISCARD_UNSAVED_MESSAGE = "Discard your unsaved changes?";
