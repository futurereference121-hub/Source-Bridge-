/** Opportunity marketplace kinds — public creation uses the three structured types only. */

export const OPPORTUNITY_KINDS = [
  "BUYER_REQUEST",
  "SOURCING_OFFER",
  "TRAVEL_OPPORTUNITY",
  "LEGACY_GENERAL",
] as const;

export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

export const CREATABLE_OPPORTUNITY_KINDS = [
  "BUYER_REQUEST",
  "SOURCING_OFFER",
  "TRAVEL_OPPORTUNITY",
] as const;

export type CreatableOpportunityKind = (typeof CREATABLE_OPPORTUNITY_KINDS)[number];

export const OPPORTUNITY_KIND_LABELS: Record<OpportunityKind, string> = {
  BUYER_REQUEST: "BUYER REQUEST",
  SOURCING_OFFER: "SOURCING OFFER",
  TRAVEL_OPPORTUNITY: "TRAVEL OPPORTUNITY",
  LEGACY_GENERAL: "OPPORTUNITY",
};

export function isOpportunityKind(value: unknown): value is OpportunityKind {
  return (
    typeof value === "string" &&
    (OPPORTUNITY_KINDS as readonly string[]).includes(value)
  );
}

export function isCreatableOpportunityKind(
  value: unknown,
): value is CreatableOpportunityKind {
  return (
    typeof value === "string" &&
    (CREATABLE_OPPORTUNITY_KINDS as readonly string[]).includes(value)
  );
}

export function responseCtaLabel(kind: OpportunityKind): string {
  switch (kind) {
    case "BUYER_REQUEST":
      return "I CAN HELP";
    case "SOURCING_OFFER":
      return "MESSAGE SOURCER";
    case "TRAVEL_OPPORTUNITY":
      return "ASK ABOUT THIS TRIP";
    default:
      return "MESSAGE";
  }
}
