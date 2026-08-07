/**
 * Listing payment option helpers.
 * Default for existing listings: CONTACT_ONLY (preserve contact/crypto until owner opts in).
 */

export const LISTING_PAYMENT_OPTIONS = [
  "CONTACT_ONLY",
  "PROTECTED_ONLY",
  "INSTANT_ONLY",
  "BOTH",
] as const;

export type ListingPaymentOption = (typeof LISTING_PAYMENT_OPTIONS)[number];

export const DEFAULT_LISTING_PAYMENT_OPTION: ListingPaymentOption =
  "CONTACT_ONLY";

export function parseListingPaymentOptions(
  raw: string | null | undefined,
): ListingPaymentOption {
  const v = (raw || DEFAULT_LISTING_PAYMENT_OPTION).toUpperCase();
  if ((LISTING_PAYMENT_OPTIONS as readonly string[]).includes(v)) {
    return v as ListingPaymentOption;
  }
  return DEFAULT_LISTING_PAYMENT_OPTION;
}

export function listingAllowsProtected(option: ListingPaymentOption): boolean {
  return option === "PROTECTED_ONLY" || option === "BOTH";
}

export function listingAllowsInstant(option: ListingPaymentOption): boolean {
  return option === "INSTANT_ONLY" || option === "BOTH";
}

export function listingAllowsContact(option: ListingPaymentOption): boolean {
  return option === "CONTACT_ONLY" || option === "BOTH";
}

/** Server-side validation of buyer-selected checkout path vs listing config. */
export function assertListingCheckoutOption(opts: {
  listingOption: string;
  selected: "contact" | "crypto" | "PROTECTED" | "INSTANT";
  /**
   * When true, CONTACT_ONLY listings may still start a allowlisted TEST
   * Protected Payment (listing card path). Instant remains blocked.
   */
  allowContactOnlyAsProtected?: boolean;
}): void {
  const option = parseListingPaymentOptions(opts.listingOption);
  if (opts.selected === "contact" || opts.selected === "crypto") {
    if (!listingAllowsContact(option) && option !== "CONTACT_ONLY") {
      // CONTACT_ONLY and legacy always allow contact/crypto
      if (option === "PROTECTED_ONLY" || option === "INSTANT_ONLY") {
        throw Object.assign(
          new Error("This listing only accepts Source Bridge payments"),
          { status: 400, code: "PAYMENT_OPTION_NOT_ALLOWED" },
        );
      }
    }
    return;
  }
  if (opts.selected === "PROTECTED" && !listingAllowsProtected(option)) {
    // TEST ramp: CONTACT_ONLY real listings may still use Protected Payment when
    // the server has already enforced allowlist + Connect + feature flags.
    if (!(opts.allowContactOnlyAsProtected && option === "CONTACT_ONLY")) {
      throw Object.assign(
        new Error("Protected Payment is not enabled for this listing"),
        { status: 400, code: "PAYMENT_OPTION_NOT_ALLOWED" },
      );
    }
  }
  if (opts.selected === "INSTANT" && !listingAllowsInstant(option)) {
    throw Object.assign(
      new Error("Instant payment is not enabled for this listing"),
      { status: 400, code: "PAYMENT_OPTION_NOT_ALLOWED" },
    );
  }
}
