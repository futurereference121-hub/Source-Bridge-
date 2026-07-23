export type Availability = "in_stock" | "limited" | "made_to_order" | "preorder";

export type Currency = "USD" | "EUR" | "THB" | "RUB";

/** Internal only — never render on the customer storefront. */
export interface SupplierInfo {
  code: string;
  region: "Thailand" | "Russia" | "Other";
  notes?: string;
}

/**
 * Public member profile. Every listing belongs to a member —
 * people are the product; location is the value.
 */
export interface Member {
  id: string;
  slug: string;
  displayName: string;
  bio: string;
  countries: string[];
  verified: boolean;
  offersPersonalSourcing: boolean;
  offersRetailListings: boolean;
  offersBusinessSourcing: boolean;
  worldwideShipping: boolean;
  avatar?: string;
  joinedAt?: string;
}

/** Alias for clarity in UI copy and future profile routes. */
export type MemberProfile = Member;

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  subcategory?: string;
  images: string[];
  price: number;
  currency: Currency;
  /** Owning member — listings are never company-owned inventory. */
  memberId: string;
  /** Origin / listing country for this product. */
  country: string;
  /** Whether shipping is available for this listing. */
  shippingAvailable: boolean;
  /** INTERNAL — do not display to customers */
  supplier?: SupplierInfo;
  availability: Availability;
  tags: string[];
  featured: boolean;
  specs?: Record<string, string>;
  shippingNote?: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  image: string;
  subcategories: Subcategory[];
}

export interface Subcategory {
  id: string;
  slug: string;
  name: string;
}

export interface NavItem {
  label: string;
  href: string;
}
