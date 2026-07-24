/** Listing stock state (not member availability). */
export type ListingAvailability =
  | "available"
  | "limited"
  | "made_to_order"
  | "to_source";

/** Member presence / readiness. */
export type Availability =
  | "available_now"
  | "limited"
  | "travelling_soon"
  | "unavailable";

export type Currency = "USD" | "EUR" | "THB" | "RUB" | "GBP" | "INR" | "MXN";

export type MemberType =
  | "local"
  | "traveller"
  | "specialist"
  | "student"
  | "nomad"
  | "collector";

export type AccountIntent = "buyer" | "provider" | "both";

export interface Location {
  city: string;
  country: string;
  /** Display string, e.g. "Bangkok, Thailand" */
  label: string;
}

export interface CountryConnection {
  country: string;
  kind: "lives" | "visits" | "sources" | "travels";
}

export interface Service {
  id: string;
  label: string;
}

export interface Journey {
  id: string;
  from: string;
  to: string;
  datesLabel: string;
  note?: string;
}

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
  placeholder?: boolean;
}

export interface Verification {
  identityVerified: boolean;
  badges: VerificationBadge[];
}

export interface Review {
  id: string;
  authorName: string;
  rating: number;
  text: string;
  dateLabel: string;
}

export interface ActivityItemData {
  id: string;
  type: "listing" | "journey" | "review" | "request" | "follow";
  title: string;
  detail: string;
  dateLabel: string;
}

/** Internal only — never render on the customer storefront. */
export interface SupplierInfo {
  code: string;
  region: string;
  notes?: string;
}

/**
 * Public member profile. Every listing belongs to a member —
 * people are the bridge; location is the value.
 */
export interface Member {
  id: string;
  slug: string;
  fullName: string;
  photo: string;
  cover: string;
  location: Location;
  /** Short help pitch shown on cards and profile. */
  howICanHelp: string;
  /** Longer bio for profile. */
  bio: string;
  memberType: MemberType;
  verification: Verification;
  bridgeScore: number;
  rating: number;
  completedRequests: number;
  services: Service[];
  connectedCountries: CountryConnection[];
  upcomingJourney?: Journey | null;
  journeys: Journey[];
  availability: Availability;
  availabilityLabel: string;
  listingIds: string[];
  reviews: Review[];
  recentActivity: ActivityItemData[];
  languages: string[];
  joinedAt?: string;
  /** Subtle prototype note when profile is seed data. */
  isPrototype?: boolean;
}

/** Marketplace listing — belongs to a member, never company inventory. */
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
  memberId: string;
  country: string;
  currentLocation: string;
  shippingAvailable: boolean;
  supplier?: SupplierInfo;
  availability: ListingAvailability;
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

export interface ExploreFilters {
  query: string;
  country: string;
  city: string;
  service: string;
  memberType: string;
  verifiedOnly: boolean;
  availableNow: boolean;
  travellingSoon: boolean;
}

/** @deprecated Prefer Listing */
export type Product = Listing;
