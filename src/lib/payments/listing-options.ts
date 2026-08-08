/**
 * Listing payment option helpers.
 *
 * Stored values (string enum):
 *   CONTACT_ONLY | PROTECTED_ONLY | INSTANT_ONLY | BOTH
 *
 * Product model (seller UI checkboxes):
 *   protectedPaymentEnabled + directPaymentEnabled (at least one required)
 *
 * INSTANT_* = Direct Payment product path (UI never says "Instant").
 *
 * Existing CONTACT_ONLY rows are treated as Protected-only for SB card checkout
 * ramps (Direct remains off) without a destructive mass migration.
 */

export const LISTING_PAYMENT_OPTIONS = [
  "CONTACT_ONLY",
  "PROTECTED_ONLY",
  "INSTANT_ONLY",
  "BOTH",
] as const;

export type ListingPaymentOption = (typeof LISTING_PAYMENT_OPTIONS)[number];

/** New listings default to Protected on, Direct off. */
export const DEFAULT_LISTING_PAYMENT_OPTION: ListingPaymentOption =
  "PROTECTED_ONLY";

export type ListingPaymentFlags = {
  protectedPaymentEnabled: boolean;
  directPaymentEnabled: boolean;
};

export function parseListingPaymentOptions(
  raw: string | null | undefined,
): ListingPaymentOption {
  const v = (raw || DEFAULT_LISTING_PAYMENT_OPTION).toUpperCase();
  if ((LISTING_PAYMENT_OPTIONS as readonly string[]).includes(v)) {
    return v as ListingPaymentOption;
  }
  return DEFAULT_LISTING_PAYMENT_OPTION;
}

/** Decode stored enum → seller checkbox flags. */
export function listingPaymentFlags(
  raw: string | null | undefined,
): ListingPaymentFlags {
  const option = parseListingPaymentOptions(raw);
  switch (option) {
    case "BOTH":
      return { protectedPaymentEnabled: true, directPaymentEnabled: true };
    case "INSTANT_ONLY":
      return { protectedPaymentEnabled: false, directPaymentEnabled: true };
    case "PROTECTED_ONLY":
      return { protectedPaymentEnabled: true, directPaymentEnabled: false };
    case "CONTACT_ONLY":
      // Legacy default: Protected path available under TEST ramp; Direct off.
      return { protectedPaymentEnabled: true, directPaymentEnabled: false };
    default:
      return { protectedPaymentEnabled: true, directPaymentEnabled: false };
  }
}

/**
 * Encode seller checkboxes → stored enum.
 * Requires at least one payment option.
 */
export function encodeListingPaymentOptions(
  flags: ListingPaymentFlags,
): ListingPaymentOption {
  const p = Boolean(flags.protectedPaymentEnabled);
  const d = Boolean(flags.directPaymentEnabled);
  if (!p && !d) {
    throw Object.assign(new Error("Choose at least one payment option."), {
      status: 400,
      code: "PAYMENT_OPTIONS_REQUIRED",
    });
  }
  if (p && d) return "BOTH";
  if (d) return "INSTANT_ONLY";
  return "PROTECTED_ONLY";
}

export function listingAllowsProtected(option: ListingPaymentOption): boolean {
  return (
    option === "PROTECTED_ONLY" ||
    option === "BOTH" ||
    // CONTACT_ONLY catalogue: Protected TEST ramp (not Direct).
    option === "CONTACT_ONLY"
  );
}

/** Direct Payment uses stored INSTANT_* enum values. */
export function listingAllowsDirect(option: ListingPaymentOption): boolean {
  return option === "INSTANT_ONLY" || option === "BOTH";
}

/** @deprecated Prefer listingAllowsDirect — aliases Instant storage name. */
export function listingAllowsInstant(option: ListingPaymentOption): boolean {
  return listingAllowsDirect(option);
}

export function listingAllowsContact(option: ListingPaymentOption): boolean {
  return option === "CONTACT_ONLY" || option === "BOTH";
}

/** Server-side validation of buyer-selected checkout path vs listing config. */
export function assertListingCheckoutOption(opts: {
  listingOption: string;
  selected: "contact" | "crypto" | "PROTECTED" | "INSTANT" | "DIRECT";
}): void {
  const option = parseListingPaymentOptions(opts.listingOption);
  if (opts.selected === "contact" || opts.selected === "crypto") {
    if (!listingAllowsContact(option) && option !== "CONTACT_ONLY") {
      if (option === "PROTECTED_ONLY" || option === "INSTANT_ONLY") {
        throw Object.assign(
          new Error("This listing only accepts Source Bridge payments"),
          { status: 400, code: "PAYMENT_OPTION_NOT_ALLOWED" },
        );
      }
    }
    return;
  }
  if (opts.selected === "PROTECTED") {
    if (!listingAllowsProtected(option)) {
      throw Object.assign(
        new Error("This item is available for Direct Payment only."),
        { status: 400, code: "PAYMENT_OPTION_NOT_ALLOWED" },
      );
    }
    return;
  }
  if (opts.selected === "INSTANT" || opts.selected === "DIRECT") {
    if (!listingAllowsDirect(option)) {
      throw Object.assign(
        new Error("This item is available for Protected Payment only."),
        { status: 400, code: "PAYMENT_OPTION_NOT_ALLOWED" },
      );
    }
  }
}
