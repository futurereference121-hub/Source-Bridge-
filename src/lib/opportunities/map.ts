import type { Opportunity as PrismaOpportunity } from "@prisma/client";
import {
  OPPORTUNITY_KIND_LABELS,
  isOpportunityKind,
  type OpportunityKind,
  responseCtaLabel,
} from "@/lib/opportunities/kinds";
import {
  isOpportunityLifecycle,
  isPubliclyListableLifecycle,
  type OpportunityLifecycle,
} from "@/lib/opportunities/lifecycle";
import { isPastExpiry } from "@/lib/opportunities/expiry";
import { parseStringArrayJson } from "@/lib/opportunities/normalize";

export type OpportunityPublic = {
  id: string;
  kind: OpportunityKind;
  kindLabel: string;
  lifecycle: OpportunityLifecycle;
  title: string;
  summary: string;
  description: string;
  city: string;
  country: string;
  category: string;
  categories: string[];
  markets: string[];
  photos: string[];
  sourceCity: string;
  sourceCountry: string;
  deliveryCity: string;
  deliveryCountry: string;
  originCity: string;
  originCountry: string;
  startsAt: string | null;
  expiresAt: string | null;
  closedAt: string | null;
  travelStartAt: string | null;
  travelEndAt: string | null;
  postedAt: string;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  budgetCurrency: string;
  quantity: string;
  deliveryMode: string;
  alternativesOk: boolean | null;
  internationalShipping: boolean | null;
  localHandover: boolean | null;
  specialistDetails: string;
  sizeLimits: string;
  luggageRestrictions: string;
  notes: string;
  active: boolean;
  responseCta: string;
  renewCount: number;
  creator?: {
    id: string;
    username: string;
    fullName: string;
    slug: string;
    photo: string;
  };
};

type OppRow = PrismaOpportunity & {
  user?: {
    id: string;
    username: string | null;
    name: string;
    slug: string | null;
    photo: string | null;
  } | null;
};

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export function resolveKind(raw: string | null | undefined): OpportunityKind {
  return isOpportunityKind(raw) ? raw : "LEGACY_GENERAL";
}

export function resolveLifecycle(
  row: Pick<PrismaOpportunity, "lifecycle" | "closedAt" | "expiresAt">,
  now = new Date(),
): OpportunityLifecycle {
  const stored = isOpportunityLifecycle(row.lifecycle)
    ? row.lifecycle
    : "OPEN";
  if (stored === "FULFILLED" || stored === "WITHDRAWN") return stored;
  if (row.closedAt) return "WITHDRAWN";
  if (isPastExpiry(row.expiresAt, now)) return "EXPIRED";
  return stored;
}

export function mapOpportunityPublic(
  row: OppRow,
  now = new Date(),
): OpportunityPublic {
  const kind = resolveKind(row.kind);
  const lifecycle = resolveLifecycle(row, now);
  const categories = parseStringArrayJson(row.categoriesJson);
  if (!categories.length && row.category) categories.push(row.category);
  const photos = parseStringArrayJson(row.photosJson);
  const markets = parseStringArrayJson(row.marketsJson);
  const active =
    !row.closedAt &&
    !isPastExpiry(row.expiresAt, now) &&
    isPubliclyListableLifecycle(lifecycle);

  const creator =
    row.user && row.user.username && row.user.slug
      ? {
          id: row.user.id,
          username: row.user.username,
          fullName: row.user.name,
          slug: row.user.slug,
          photo: row.user.photo || "/placeholders/avatar.svg",
        }
      : undefined;

  return {
    id: row.id,
    kind,
    kindLabel: OPPORTUNITY_KIND_LABELS[kind],
    lifecycle,
    title: row.title,
    summary: row.title,
    description: row.description,
    city: row.city,
    country: row.country,
    category: row.category,
    categories,
    markets,
    photos,
    sourceCity: row.sourceCity || "",
    sourceCountry: row.sourceCountry || "",
    deliveryCity: row.deliveryCity || "",
    deliveryCountry: row.deliveryCountry || "",
    originCity: row.originCity || "",
    originCountry: row.originCountry || "",
    startsAt: iso(row.startsAt),
    expiresAt: iso(row.expiresAt),
    closedAt: iso(row.closedAt),
    travelStartAt: iso(row.travelStartAt),
    travelEndAt: iso(row.travelEndAt),
    postedAt: row.postedAt.toISOString(),
    budgetMinMinor: row.budgetMinMinor,
    budgetMaxMinor: row.budgetMaxMinor,
    budgetCurrency: row.budgetCurrency || "",
    quantity: row.quantity || "",
    deliveryMode: row.deliveryMode || "",
    alternativesOk: row.alternativesOk,
    internationalShipping: row.internationalShipping,
    localHandover: row.localHandover,
    specialistDetails: row.specialistDetails || "",
    sizeLimits: row.sizeLimits || "",
    luggageRestrictions: row.luggageRestrictions || "",
    notes: row.notes || "",
    active,
    responseCta: responseCtaLabel(kind),
    renewCount: row.renewCount,
    creator,
  };
}

/** Compact legacy Opportunity shape used by Member / Explore feed mapping. */
export function mapOpportunityLegacyCompat(row: OppRow) {
  const pub = mapOpportunityPublic(row);
  return {
    id: pub.id,
    title: pub.title,
    summary: pub.title,
    description: pub.description,
    availability: undefined as string | undefined,
    travel: undefined as string | undefined,
    localAccess: undefined as string | undefined,
    stock: undefined as string | undefined,
    categories: pub.categories,
    category: pub.category,
    city: pub.city,
    country: pub.country,
    postedAt: pub.postedAt,
    startsAt: pub.startsAt,
    expiresAt: pub.expiresAt,
    closedAt: pub.closedAt,
    kind: pub.kind,
    kindLabel: pub.kindLabel,
    lifecycle: pub.lifecycle,
    photos: pub.photos,
    budgetMinMinor: pub.budgetMinMinor,
    budgetMaxMinor: pub.budgetMaxMinor,
    budgetCurrency: pub.budgetCurrency,
    deliveryCity: pub.deliveryCity,
    deliveryCountry: pub.deliveryCountry,
    sourceCity: pub.sourceCity,
    sourceCountry: pub.sourceCountry,
    originCity: pub.originCity,
    originCountry: pub.originCountry,
    travelStartAt: pub.travelStartAt,
    travelEndAt: pub.travelEndAt,
    quantity: pub.quantity,
    markets: pub.markets,
    deliveryMode: pub.deliveryMode,
    internationalShipping: pub.internationalShipping,
    localHandover: pub.localHandover,
    notes: pub.notes,
    specialistDetails: pub.specialistDetails,
    luggageRestrictions: pub.luggageRestrictions,
    alternativesOk: pub.alternativesOk,
    active: pub.active,
  };
}

/** Immutable human-readable snapshot for messaging context (no raw IDs). */
export function buildOpportunityMessageContext(pub: OpportunityPublic): string {
  const lines: string[] = [`About: ${pub.kindLabel} — ${pub.title}`];
  if (pub.description) {
    lines.push(pub.description.slice(0, 280));
  }
  if (pub.kind === "BUYER_REQUEST") {
    const source = [pub.sourceCity || pub.city, pub.sourceCountry || pub.country]
      .filter(Boolean)
      .join(", ");
    if (source) lines.push(`Source from: ${source}`);
    const delivery = [pub.deliveryCity, pub.deliveryCountry]
      .filter(Boolean)
      .join(", ");
    if (delivery) lines.push(`Deliver to: ${delivery}`);
    if (pub.quantity?.trim()) lines.push(`Quantity: ${pub.quantity.trim()}`);
  } else if (pub.kind === "SOURCING_OFFER") {
    const available = [pub.sourceCity || pub.city, pub.sourceCountry || pub.country]
      .filter(Boolean)
      .join(", ");
    if (available) lines.push(`Available in: ${available}`);
  } else if (pub.kind === "TRAVEL_OPPORTUNITY") {
    const origin = [pub.originCity, pub.originCountry].filter(Boolean).join(", ");
    const dest = [pub.city, pub.country].filter(Boolean).join(", ");
    if (origin && dest) lines.push(`Travelling: ${origin} → ${dest}`);
    else if (dest) lines.push(`Travelling to: ${dest}`);
    if (pub.markets.length) {
      lines.push(`Markets / areas: ${pub.markets.join(", ")}`);
    }
  } else {
    const source = [pub.city, pub.country].filter(Boolean).join(", ");
    if (source) lines.push(`Location: ${source}`);
  }
  if (pub.travelStartAt || pub.travelEndAt) {
    const start = pub.travelStartAt
      ? new Date(pub.travelStartAt).toLocaleDateString()
      : "";
    const end = pub.travelEndAt
      ? new Date(pub.travelEndAt).toLocaleDateString()
      : "";
    lines.push(`Travel dates: ${[start, end].filter(Boolean).join(" → ")}`);
  }
  if (
    pub.budgetCurrency &&
    (pub.budgetMinMinor != null || pub.budgetMaxMinor != null)
  ) {
    lines.push(
      `Budget (informational): ${formatBudget(
        pub.budgetMinMinor,
        pub.budgetMaxMinor,
        pub.budgetCurrency,
      )}`,
    );
  }
  lines.push("(Draft only — not sent until you send a message.)");
  return lines.join("\n");
}

function formatBudget(
  min: number | null,
  max: number | null,
  currency: string,
): string {
  const fmt = (n: number) =>
    `${(n / 100).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })} ${currency.toUpperCase()}`;
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)}`;
  if (min != null) return `from ${fmt(min)}`;
  if (max != null) return `up to ${fmt(max)}`;
  return currency;
}
