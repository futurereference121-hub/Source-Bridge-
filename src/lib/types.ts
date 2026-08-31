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
  /** Optional ISO-style codes for suggestion maps */
  cityCode?: string;
  countryCode?: string;
}

export interface CountryConnection {
  country: string;
  kind: "lives" | "visits" | "sources" | "travels";
}

/** City in a member's available network. */
export interface NetworkCity {
  city: string;
  country: string;
  countryCode?: string;
  cityCode?: string;
}

/** Upcoming trip — simple schedule line, not a calendar. */
export interface Trip {
  id: string;
  city: string;
  country: string;
  /** ISO date YYYY-MM-DD when available */
  arrival?: string;
  /** ISO date YYYY-MM-DD when available */
  departure?: string;
  /** Display range, e.g. "12–28 August" or "2026-08-12 → 2026-08-28" */
  dateRange: string;
}

/** Max one active status per member; expires after 24h. */
export interface MemberStatus {
  text: string;
  postedAt: string;
  expiresAt: string;
}

/**
 * Opportunity post — separate from status.
 * Structured location codes enable controlled category suggestions later.
 */
export interface Opportunity {
  id: string;
  /** Primary title (new). Falls back to summary for seed data. */
  title?: string;
  summary: string;
  description?: string;
  availability?: string;
  travel?: string;
  localAccess?: string;
  stock?: string;
  categories: string[];
  category?: string;
  city: string;
  country: string;
  cityCode?: string;
  countryCode?: string;
  postedAt: string;
  startsAt?: string | null;
  expiresAt?: string | null;
  closedAt?: string | null;
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
  /** ONLY source of Verified badge in UI. Never granted for email verification. */
  identityVerified: boolean;
  badges: VerificationBadge[];
}

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
  /** Marketplace lifecycle: AVAILABLE | RESERVED | SOLD | ARCHIVED */
  saleStatus?: string;
  tags: string[];
  featured: boolean;
  specs?: Record<string, string>;
  shippingNote?: string;
  quantity?: string;
  /** Clothing sizes — replaces quantity for clothing listings. */
  sizes?: string[];
  productKind?: "clothing" | "general" | string;
  material?: string;
  brand?: string;
  condition?: string;
  colour?: string;
  pattern?: string;
  fit?: string;
  gender?: string;
  shipFromCity?: string;
  shipFromCountry?: string;
  /** True when sourced from PostgreSQL rather than seed catalogue. */
  isDbListing?: boolean;
  /**
   * Listing payment options enum:
   * CONTACT_ONLY | PROTECTED_ONLY | INSTANT_ONLY | BOTH
   * INSTANT_* = Direct Payment product path.
   */
  paymentOptions?: string;
  protectedPaymentEnabled?: boolean;
  directPaymentEnabled?: boolean;
}

export interface Review {
  id: string;
  authorName: string;
  rating: number;
  text: string;
  dateLabel: string;
  transactionTitle?: string;
}

export interface ActivityItemData {
  id: string;
  type: "listing" | "journey" | "review" | "request" | "follow";
  title: string;
  detail: string;
  dateLabel: string;
}

/** Live feed item — status, opportunity, or Source Bridge Live. */
export type FeedItemKind = "status" | "opportunity" | "live" | "was_live";

export interface FeedItem {
  id: string;
  kind: FeedItemKind;
  memberId: string;
  memberSlug: string;
  username: string;
  fullName: string;
  photo: string;
  text: string;
  /** City for opportunity posts; location label for Live. */
  city?: string;
  /** Country for opportunity posts */
  country?: string;
  postedAt: string;
  startsAt?: string;
  expiresAt?: string;
  liveSessionId?: string;
  liveKind?: "live" | "was_live";
}

/** In-app notification centre event types. */
export type NotificationType =
  | "OPPORTUNITY"
  | "STATUS"
  | "MESSAGE"
  | "SOURCING_REQUEST"
  | "LISTING_ENQUIRY"
  | "OPPORTUNITY_ENQUIRY"
  | "PAYMENT_TICKET"
  | "PAYMENT_STATUS"
  | "PAYMENT_SHIPPING"
  | "PAYMENT_DISPUTE"
  | "SYSTEM";

/** Client-facing notification — never carries private message bodies. */
export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string;
  actorId: string | null;
  actorName: string;
  read: boolean;
  createdAt: string;
}

/** Internal only — never render on the customer storefront. */
export interface SupplierInfo {
  code: string;
  region: string;
  notes?: string;
}

/**
 * Public member profile. Profiles are the product;
 * listings attach to people.
 */
export interface Member {
  id: string;
  slug: string;
  /** Primary identity, without @ — e.g. "globalnomad" */
  username: string;
  fullName: string;
  photo: string;
  cover: string;
  location: Location;
  /**
   * Public Display Message (≤160). Prefer this over howICanHelp for cards.
   * Blank for new real accounts — hide blue box when empty.
   */
  publicDisplayMessage?: string;
  /** @deprecated Prefer publicDisplayMessage; kept for seed compatibility. */
  howICanHelp: string;
  /** Longer bio for profile. */
  bio: string;
  memberType: MemberType;
  verification: Verification;
  /** Explicit mirrors — Verified badge uses identityVerified ONLY. */
  emailVerified?: boolean;
  identityVerified?: boolean;
  /** UNVERIFIED | PENDING | VERIFIED | REJECTED */
  identityVerificationStatus?: string;
  /** Internal / seed only — never render Bridge Score in UI. */
  bridgeScore: number;
  rating: number;
  completedRequests: number;
  services: Service[];
  /** Cities the member can help from / through. */
  network: NetworkCity[];
  /** Upcoming trips as simple schedule lines. */
  trips: Trip[];
  /** Max one active status; null when none / expired. */
  status: MemberStatus | null;
  /** Newest active opportunity (compat). */
  opportunity: Opportunity | null;
  /** All active opportunities for real accounts. */
  opportunities?: Opportunity[];
  connectedCountries: CountryConnection[];
  upcomingJourney?: Journey | null;
  journeys: Journey[];
  availability: Availability;
  availabilityLabel: string;
  listingIds: string[];
  /** Hydrated stock when loaded with full profile include. */
  listings?: Listing[];
  reviews: Review[];
  recentActivity: ActivityItemData[];
  languages: string[];
  joinedAt?: string;
  /** Subtle prototype note when profile is seed data. */
  isPrototype?: boolean;
  /** Controlled showcase / demo account — show “Showcase profile”, not a real verified person. */
  isDemo?: boolean;
  isRealAccount?: boolean;
  followerCount?: number;
  followingCount?: number;
  /** Public profile video (≤90s). */
  profileVideo?: {
    url: string;
    posterUrl: string;
    durationSec: number | null;
    mime: string;
    caption: string;
    updatedAt: string | null;
  } | null;
}

/** Listing type is defined above with clothing/shipping fields. */

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

/** Client session account (safe public fields). */
export interface AccountSession {
  id: string;
  email: string;
  emailVerified: boolean;
  identityVerified: boolean;
  /** UNVERIFIED | PENDING | VERIFIED | REJECTED */
  identityVerificationStatus?: string;
  role?: string;
  isAdmin?: boolean;
  mustChangePassword?: boolean;
  hasPassword?: boolean;
  name: string;
  username: string | null;
  slug: string | null;
  photo: string;
  onboardingComplete: boolean;
  intent: string;
  isDiscoverable?: boolean;
  isTestAccount?: boolean;
  notificationSoundsEnabled?: boolean;
  notificationVolume?: string;
}

/** @deprecated Prefer Listing */
export type Product = Listing;
