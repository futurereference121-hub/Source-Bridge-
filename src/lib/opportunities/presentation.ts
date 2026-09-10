/**
 * Shared Opportunity compact / expanded presentation helpers.
 * Labels must never imply sourcing location is the poster's current location.
 */

import type { OpportunityKind } from "@/lib/opportunities/kinds";
import { OPPORTUNITY_KIND_LABELS } from "@/lib/opportunities/kinds";

export const DELIVERY_MODE_VALUES = ["SHIP", "HAND", "EITHER"] as const;
export type DeliveryModeValue = (typeof DELIVERY_MODE_VALUES)[number];

export const DELIVERY_MODE_OPTIONS: {
  value: DeliveryModeValue;
  label: string;
}[] = [
  { value: "SHIP", label: "Shipping" },
  { value: "HAND", label: "Hand-delivery / local handover" },
  { value: "EITHER", label: "Either / not sure" },
];

export function isDeliveryModeValue(v: unknown): v is DeliveryModeValue {
  return (
    typeof v === "string" &&
    (DELIVERY_MODE_VALUES as readonly string[]).includes(v)
  );
}

export function deliveryModeLabel(mode: string | null | undefined): string | null {
  if (!mode) return null;
  const hit = DELIVERY_MODE_OPTIONS.find((o) => o.value === mode);
  return hit?.label ?? null;
}

/** Optional positive whole number; empty stays empty — never silent-default to 1. */
export function normalizeOpportunityQuantity(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: "" };
  const s = String(raw).trim();
  if (!s) return { ok: true, value: "" };
  if (!/^[1-9]\d{0,8}$/.test(s)) {
    return {
      ok: false,
      error: "Quantity must be a positive whole number",
    };
  }
  return { ok: true, value: s };
}

/** Parse markets / areas text into a trimmed unique list (max 12, 80 chars each). */
export function normalizeMarketsInput(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return uniqueTrimmed(
      raw.filter((x): x is string => typeof x === "string"),
    );
  }
  if (typeof raw !== "string") return [];
  return uniqueTrimmed(
    raw
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function uniqueTrimmed(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const t = item.trim().slice(0, 80);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

export type CompactMetaLine = { label: string; value: string };

export type CompactOpportunityFields = {
  kind: OpportunityKind | string;
  city?: string | null;
  country?: string | null;
  sourceCity?: string | null;
  sourceCountry?: string | null;
  deliveryCity?: string | null;
  deliveryCountry?: string | null;
  originCity?: string | null;
  originCountry?: string | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  travelStartAt?: string | null;
  travelEndAt?: string | null;
  quantity?: string | null;
  budgetMinMinor?: number | null;
  budgetMaxMinor?: number | null;
  budgetCurrency?: string | null;
  markets?: string[] | null;
  internationalShipping?: boolean | null;
  localHandover?: boolean | null;
  deliveryMode?: string | null;
};

function place(
  city?: string | null,
  country?: string | null,
): string {
  return [city, country].filter(Boolean).join(", ");
}

function fmtDate(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

/** Format budget for authenticated expanded detail only (not compact cards). */
export function formatOpportunityBudget(fields: {
  budgetMinMinor?: number | null;
  budgetMaxMinor?: number | null;
  budgetCurrency?: string | null;
}): string | null {
  if (!fields.budgetCurrency) return null;
  if (fields.budgetMinMinor == null && fields.budgetMaxMinor == null) return null;
  const fmt = (n: number) =>
    (n / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const cur = fields.budgetCurrency.toUpperCase();
  if (fields.budgetMinMinor != null && fields.budgetMaxMinor != null) {
    return `${fmt(fields.budgetMinMinor)}–${fmt(fields.budgetMaxMinor)} ${cur}`;
  }
  if (fields.budgetMinMinor != null) {
    return `from ${fmt(fields.budgetMinMinor)} ${cur}`;
  }
  return `up to ${fmt(fields.budgetMaxMinor!)} ${cur}`;
}

function shipHandWording(fields: CompactOpportunityFields): string | null {
  const ship = fields.internationalShipping === true;
  const hand = fields.localHandover === true;
  if (ship && hand) return "Can ship or hand-deliver";
  if (ship) return "Can ship";
  if (hand) return "Hand-deliver / local handover";
  return null;
}

/**
 * Concise labelled meta lines for compact tickets (Explore + Marketplace).
 */
export function buildCompactOpportunityLines(
  fields: CompactOpportunityFields,
  opts?: { includeMarkets?: boolean },
): CompactMetaLine[] {
  const kind = (fields.kind || "LEGACY_GENERAL") as OpportunityKind;
  const lines: CompactMetaLine[] = [];

  if (kind === "BUYER_REQUEST") {
    const source =
      place(fields.sourceCity, fields.sourceCountry) ||
      place(fields.city, fields.country);
    const delivery = place(fields.deliveryCity, fields.deliveryCountry);
    if (source) lines.push({ label: "SOURCE FROM", value: source });
    if (delivery) lines.push({ label: "DELIVER TO", value: delivery });
    const needed = fmtDate(fields.expiresAt);
    if (needed) lines.push({ label: "NEEDED BY", value: needed });
    if (fields.quantity?.trim()) {
      lines.push({ label: "QTY", value: fields.quantity.trim() });
    }
    // Budget is authenticated full-detail only — never on compact teasers.
    return lines;
  }

  if (kind === "SOURCING_OFFER") {
    const available =
      place(fields.sourceCity, fields.sourceCountry) ||
      place(fields.city, fields.country);
    if (available) lines.push({ label: "AVAILABLE IN", value: available });
    const until = fmtDate(fields.expiresAt);
    if (until) lines.push({ label: "AVAILABLE UNTIL", value: until });
    const shipHand = shipHandWording(fields);
    if (shipHand) lines.push({ label: "FULFILMENT", value: shipHand });
    return lines;
  }

  if (kind === "TRAVEL_OPPORTUNITY") {
    const origin = place(fields.originCity, fields.originCountry);
    const dest =
      place(fields.city, fields.country) ||
      place(fields.sourceCity, fields.sourceCountry);
    if (origin && dest) {
      lines.push({ label: "TRAVELLING", value: `${origin} → ${dest}` });
    } else if (dest) {
      lines.push({ label: "TRAVELLING TO", value: dest });
    }
    const start = fmtDate(fields.travelStartAt || fields.startsAt);
    const end = fmtDate(fields.travelEndAt || fields.expiresAt);
    if (start && end) {
      lines.push({ label: "TRAVEL DATES", value: `${start} – ${end}` });
    } else if (start) {
      lines.push({ label: "TRAVEL START", value: start });
    } else if (end) {
      lines.push({ label: "TRAVEL END", value: end });
    }
    if (opts?.includeMarkets && fields.markets?.length) {
      const preview = fields.markets.slice(0, 2).join(", ");
      lines.push({
        label: "MARKETS",
        value:
          fields.markets.length > 2
            ? `${preview} +${fields.markets.length - 2}`
            : preview,
      });
    }
    const shipHand = shipHandWording(fields);
    if (shipHand && lines.length < 4) {
      lines.push({ label: "CAN", value: shipHand });
    }
    return lines;
  }

  // LEGACY_GENERAL — neutral; do not fabricate structured meaning
  const loc = place(fields.city, fields.country);
  if (loc) lines.push({ label: "LOCATION", value: loc });
  const end = fmtDate(fields.expiresAt);
  if (end) lines.push({ label: "UNTIL", value: end });
  return lines;
}

export function opportunityKindBadgeLabel(kind: string | null | undefined): string {
  if (kind && kind in OPPORTUNITY_KIND_LABELS) {
    return OPPORTUNITY_KIND_LABELS[kind as OpportunityKind];
  }
  return OPPORTUNITY_KIND_LABELS.LEGACY_GENERAL;
}

/** Strip `opp-` prefix from feed item ids. */
export function parseOpportunityIdFromFeedItemId(id: string): string | null {
  if (id.startsWith("opp-")) return id.slice(4) || null;
  return null;
}
