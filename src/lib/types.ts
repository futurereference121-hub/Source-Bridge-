export type Availability = "available" | "limited" | "made_to_order" | "to_source";

export type Currency = "USD" | "EUR" | "THB" | "RUB";

/** Internal only — never render on the customer storefront. */
export interface SupplierInfo {
  code: string;
  region: "Thailand" | "Russia" | "Other";
  notes?: string;
}

/** How a member can help — shown on profile storefronts. */
export type MemberServiceKey =
  | "canSource"
  | "canInspect"
  | "canNegotiate"
  | "canTranslate"
  | "canRecommendSuppliers"
  | "canReceiveDeliveries"
  | "canShipInternationally"
  | "canCarryWhileTravelling"
  | "hasLocalKnowledge";

export type MemberServices = Record<MemberServiceKey, boolean>;

export type VerificationBadgeKind =
  | "verified_identity"
  | "trusted_member"
  | "specialist"
  | "business_verified"
  | "traveller"
  | "top_rated";

export interface VerificationBadge {
  kind: VerificationBadgeKind;
  label: string;
  /** Placeholder until verification workflow ships. */
  placeholder?: boolean;
}

export interface BridgeScorePlaceholder {
  /** Display score 0–100; UI only until real logic exists. */
  score: number;
  label: string;
  note: string;
}

export interface ReviewStatsPlaceholder {
  averageRating: number;
  totalReviews: number;
  completedRequests: number;
  note: string;
}

export interface JourneyPlaceholder {
  id: string;
  from: string;
  to: string;
  datesLabel: string;
  note?: string;
}

/**
 * Public member profile. Every listing belongs to a member —
 * people are the bridge; location is the value.
 */
export interface Member {
  id: string;
  slug: string;
  displayName: string;
  photo: string;
  cover: string;
  bio: string;
  languages: string[];
  currentLocation: string;
  countries: string[];
  areasWillingToTravel: string[];
  availability: string;
  services: MemberServices;
  bridgeScore: BridgeScorePlaceholder;
  badges: VerificationBadge[];
  responseRate: number;
  reviews: ReviewStatsPlaceholder;
  upcomingJourneys: JourneyPlaceholder[];
  listingIds: string[];
  joinedAt?: string;
}

/** Alias for clarity in UI copy and future profile routes. */
export type MemberProfile = Member;

/** Marketplace listing (avoid "product/inventory/stock" in user-facing copy). */
export interface Listing {
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
  /** Origin / listing country. */
  country: string;
  /** Member's current location display for this listing context. */
  currentLocation: string;
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

/** @deprecated Prefer Listing — kept as alias during migration. */
export type Product = Listing;

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
