import { z } from "zod";
import { CREATABLE_OPPORTUNITY_KINDS } from "@/lib/opportunities/kinds";

const place = z.string().trim().max(80);
const placeRequired = place.min(1, "Required");
const optionalIso = z.string().datetime().optional().nullable();
const photosSchema = z
  .array(z.string().trim().url().or(z.string().trim().startsWith("/")))
  .max(6)
  .optional()
  .default([]);
const categoriesSchema = z
  .array(z.string().trim().min(1).max(80))
  .max(8)
  .optional()
  .default([]);

const budgetSchema = z
  .object({
    minMinor: z.number().int().nonnegative().nullable().optional(),
    maxMinor: z.number().int().nonnegative().nullable().optional(),
    currency: z.string().trim().max(8).optional().default(""),
  })
  .optional();

/** Legacy generic create (still accepted for edits of historical rows only via PATCH). */
export const opportunitySchema = z.object({
  title: z.string().trim().max(120).optional().default(""),
  description: z.string().trim().min(1, "Description required").max(2000),
  city: z.string().trim().min(1, "City required").max(80),
  country: z.string().trim().min(1, "Country required").max(80),
  category: z.string().trim().max(80).optional().default(""),
  startsAt: optionalIso,
  expiresAt: optionalIso,
});

const buyerRequestFields = z.object({
  kind: z.literal("BUYER_REQUEST"),
  title: z.string().trim().min(1, "Title required").max(120),
  description: z.string().trim().min(1, "Description required").max(2000),
  sourceCity: placeRequired,
  sourceCountry: placeRequired,
  deliveryCity: placeRequired,
  deliveryCountry: placeRequired,
  category: z.string().trim().max(80).optional().default(""),
  categories: categoriesSchema,
  photos: photosSchema,
  quantity: z.string().trim().max(40).optional().default(""),
  budget: budgetSchema,
  deadline: optionalIso,
  alternativesOk: z.boolean().optional().nullable(),
  deliveryMode: z.enum(["SHIP", "HAND", "EITHER", ""]).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  clientRequestId: z.string().trim().min(8).max(80).optional(),
});

const sourcingOfferFields = z.object({
  kind: z.literal("SOURCING_OFFER"),
  title: z.string().trim().min(1, "Title required").max(120),
  description: z.string().trim().min(1, "Description required").max(2000),
  sourceCity: placeRequired,
  sourceCountry: placeRequired,
  categories: categoriesSchema,
  photos: photosSchema,
  availabilityEndsAt: optionalIso,
  internationalShipping: z.boolean().optional().nullable(),
  localHandover: z.boolean().optional().nullable(),
  specialistDetails: z.string().trim().max(2000).optional().default(""),
  sizeLimits: z.string().trim().max(500).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  clientRequestId: z.string().trim().min(8).max(80).optional(),
});

const travelOpportunityFields = z.object({
  kind: z.literal("TRAVEL_OPPORTUNITY"),
  title: z.string().trim().max(120).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  destinationCity: placeRequired,
  destinationCountry: placeRequired,
  travelStartAt: z.string().datetime({ message: "Travel start required" }),
  travelEndAt: z.string().datetime({ message: "Travel end required" }),
  originCity: place.optional().default(""),
  originCountry: place.optional().default(""),
  markets: categoriesSchema,
  categories: categoriesSchema,
  photos: photosSchema,
  canShip: z.boolean().optional().nullable(),
  canHandDeliver: z.boolean().optional().nullable(),
  luggageRestrictions: z.string().trim().max(500).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  clientRequestId: z.string().trim().min(8).max(80).optional(),
});

export const structuredOpportunityCreateSchema = z
  .discriminatedUnion("kind", [
    buyerRequestFields,
    sourcingOfferFields,
    travelOpportunityFields,
  ])
  .superRefine((data, ctx) => {
    if (data.kind === "TRAVEL_OPPORTUNITY") {
      const start = new Date(data.travelStartAt);
      const end = new Date(data.travelEndAt);
      if (end.getTime() < start.getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Travel end must be on or after travel start",
          path: ["travelEndAt"],
        });
      }
    }
    if (data.kind === "BUYER_REQUEST" && data.budget) {
      const { minMinor, maxMinor } = data.budget;
      if (
        minMinor != null &&
        maxMinor != null &&
        maxMinor < minMinor
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Budget max must be >= min",
          path: ["budget", "maxMinor"],
        });
      }
    }
  });

export type StructuredOpportunityCreate = z.infer<
  typeof structuredOpportunityCreateSchema
>;

export const opportunityLifecycleActionSchema = z.object({
  action: z.enum([
    "withdraw",
    "mark_matched",
    "mark_fulfilled",
    "mark_in_discussion",
    "reopen_discussion",
    "renew",
  ]),
  /** Renew extends period; optional explicit new expiry ISO. */
  renewUntil: optionalIso,
  clientRequestId: z.string().trim().min(8).max(80).optional(),
});

export const opportunityMarketplaceQuerySchema = z.object({
  mode: z.enum(["for_you", "latest"]).default("latest"),
  cursor: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(40).default(20),
  kind: z
    .enum([...CREATABLE_OPPORTUNITY_KINDS, "LEGACY_GENERAL", "ALL"] as const)
    .optional()
    .default("ALL"),
  country: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).optional(),
  deliveryCountry: z.string().trim().max(80).optional(),
  deliveryCity: z.string().trim().max(80).optional(),
  openOnly: z
    .union([z.literal("1"), z.literal("0"), z.literal("true"), z.literal("false")])
    .optional(),
  deadlineFrom: z.string().datetime().optional(),
  deadlineTo: z.string().datetime().optional(),
});
