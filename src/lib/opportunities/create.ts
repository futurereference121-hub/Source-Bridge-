import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeOpportunityExpiresAt } from "@/lib/opportunities/expiry";
import {
  normalizePlaceDisplay,
  stringifyStringArray,
} from "@/lib/opportunities/normalize";
import type { StructuredOpportunityCreate } from "@/lib/opportunities/validation";
import { normalizeOpportunityQuantity } from "@/lib/opportunities/presentation";

function autoTravelTitle(city: string, country: string): string {
  const place = [city, country].filter(Boolean).join(", ");
  return place ? `Travelling to ${place}` : "Travel opportunity";
}

/**
 * Map structured create payload → Prisma create data.
 * Budget fields are informational only — never touch payment services.
 */
export function buildStructuredOpportunityData(
  userId: string,
  input: StructuredOpportunityCreate,
  now = new Date(),
): Prisma.OpportunityCreateInput {
  if (input.kind === "BUYER_REQUEST") {
    const sourceCity = normalizePlaceDisplay(input.sourceCity);
    const sourceCountry = normalizePlaceDisplay(input.sourceCountry);
    const deliveryCity = normalizePlaceDisplay(input.deliveryCity);
    const deliveryCountry = normalizePlaceDisplay(input.deliveryCountry);
    const deadline = input.deadline ? new Date(input.deadline) : null;
    const expiresAt = computeOpportunityExpiresAt({
      kind: "BUYER_REQUEST",
      now,
      deadline,
    });
    const categories = input.categories?.length
      ? input.categories
      : input.category
        ? [input.category]
        : [];
    return {
      user: { connect: { id: userId } },
      kind: "BUYER_REQUEST",
      lifecycle: "OPEN",
      stateChangedAt: now,
      title: input.title.trim(),
      description: input.description.trim(),
      city: sourceCity,
      country: sourceCountry,
      category: categories[0] || input.category || "General",
      sourceCity,
      sourceCountry,
      deliveryCity,
      deliveryCountry,
      quantity: (() => {
        const q = normalizeOpportunityQuantity(input.quantity);
        return q.ok ? q.value : "";
      })(),
      budgetMinMinor: input.budget?.minMinor ?? null,
      budgetMaxMinor: input.budget?.maxMinor ?? null,
      budgetCurrency: (input.budget?.currency || "").toUpperCase(),
      deliveryMode: input.deliveryMode || "",
      alternativesOk: input.alternativesOk ?? null,
      notes: input.notes || "",
      photosJson: stringifyStringArray(input.photos),
      categoriesJson: stringifyStringArray(categories),
      startsAt: null,
      expiresAt,
      clientRequestId: input.clientRequestId || null,
    };
  }

  if (input.kind === "SOURCING_OFFER") {
    const sourceCity = normalizePlaceDisplay(input.sourceCity);
    const sourceCountry = normalizePlaceDisplay(input.sourceCountry);
    const availabilityEndsAt = input.availabilityEndsAt
      ? new Date(input.availabilityEndsAt)
      : null;
    const expiresAt = computeOpportunityExpiresAt({
      kind: "SOURCING_OFFER",
      now,
      availabilityEndsAt,
    });
    return {
      user: { connect: { id: userId } },
      kind: "SOURCING_OFFER",
      lifecycle: "OPEN",
      stateChangedAt: now,
      title: input.title.trim(),
      description: input.description.trim(),
      city: sourceCity,
      country: sourceCountry,
      category: input.categories?.[0] || "General",
      sourceCity,
      sourceCountry,
      internationalShipping: input.internationalShipping ?? null,
      localHandover: input.localHandover ?? null,
      specialistDetails: input.specialistDetails || "",
      sizeLimits: input.sizeLimits || "",
      notes: input.notes || "",
      photosJson: stringifyStringArray(input.photos),
      categoriesJson: stringifyStringArray(input.categories),
      startsAt: null,
      expiresAt,
      clientRequestId: input.clientRequestId || null,
    };
  }

  const destinationCity = normalizePlaceDisplay(input.destinationCity);
  const destinationCountry = normalizePlaceDisplay(input.destinationCountry);
  const travelStartAt = new Date(input.travelStartAt);
  const travelEndAt = new Date(input.travelEndAt);
  const expiresAt = computeOpportunityExpiresAt({
    kind: "TRAVEL_OPPORTUNITY",
    now,
    travelEndAt,
  });
  const title =
    input.title?.trim() || autoTravelTitle(destinationCity, destinationCountry);
  const description =
    input.description?.trim() ||
    `Travelling to ${destinationCity}, ${destinationCountry}`;

  return {
    user: { connect: { id: userId } },
    kind: "TRAVEL_OPPORTUNITY",
    lifecycle: "OPEN",
    stateChangedAt: now,
    title,
    description,
    city: destinationCity,
    country: destinationCountry,
    category: input.categories?.[0] || input.markets?.[0] || "Travel",
    sourceCity: destinationCity,
    sourceCountry: destinationCountry,
    originCity: normalizePlaceDisplay(input.originCity),
    originCountry: normalizePlaceDisplay(input.originCountry),
    travelStartAt,
    travelEndAt,
    startsAt: travelStartAt,
    expiresAt,
    internationalShipping: input.canShip ?? null,
    localHandover: input.canHandDeliver ?? null,
    luggageRestrictions: input.luggageRestrictions || "",
    notes: input.notes || "",
    photosJson: stringifyStringArray(input.photos),
    categoriesJson: stringifyStringArray(input.categories),
    marketsJson: stringifyStringArray(input.markets),
    clientRequestId: input.clientRequestId || null,
  };
}

/** Near-duplicate protection: same user, kind, title, primary place within 24h. */
export async function findRecentDuplicateOpportunity(opts: {
  userId: string;
  kind: string;
  title: string;
  city: string;
  country: string;
  withinMs?: number;
}): Promise<{ id: string } | null> {
  const since = new Date(Date.now() - (opts.withinMs ?? 24 * 60 * 60 * 1000));
  return prisma.opportunity.findFirst({
    where: {
      userId: opts.userId,
      kind: opts.kind,
      title: opts.title,
      city: opts.city,
      country: opts.country,
      postedAt: { gte: since },
      closedAt: null,
      lifecycle: { in: ["OPEN", "IN_DISCUSSION", "MATCHED"] },
    },
    select: { id: true },
    orderBy: { postedAt: "desc" },
  });
}

export async function findByClientRequestId(
  userId: string,
  clientRequestId: string,
) {
  return prisma.opportunity.findFirst({
    where: { userId, clientRequestId },
  });
}
