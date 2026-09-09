/** Server-authoritative Opportunity lifecycle. */

export const OPPORTUNITY_LIFECYCLES = [
  "OPEN",
  "IN_DISCUSSION",
  "MATCHED",
  "FULFILLED",
  "EXPIRED",
  "WITHDRAWN",
] as const;

export type OpportunityLifecycle = (typeof OPPORTUNITY_LIFECYCLES)[number];

/** Public feeds exclude these immediately. */
export const PUBLIC_INACTIVE_LIFECYCLES: readonly OpportunityLifecycle[] = [
  "FULFILLED",
  "EXPIRED",
  "WITHDRAWN",
];

export const PUBLIC_ACTIVE_LIFECYCLES: readonly OpportunityLifecycle[] = [
  "OPEN",
  "IN_DISCUSSION",
  "MATCHED",
];

const ALLOWED_TRANSITIONS: Record<
  OpportunityLifecycle,
  readonly OpportunityLifecycle[]
> = {
  OPEN: ["IN_DISCUSSION", "MATCHED", "FULFILLED", "EXPIRED", "WITHDRAWN"],
  IN_DISCUSSION: ["OPEN", "MATCHED", "FULFILLED", "EXPIRED", "WITHDRAWN"],
  MATCHED: ["IN_DISCUSSION", "FULFILLED", "EXPIRED", "WITHDRAWN"],
  FULFILLED: [],
  EXPIRED: [],
  WITHDRAWN: [],
};

export function isOpportunityLifecycle(
  value: unknown,
): value is OpportunityLifecycle {
  return (
    typeof value === "string" &&
    (OPPORTUNITY_LIFECYCLES as readonly string[]).includes(value)
  );
}

export function canTransitionLifecycle(
  from: OpportunityLifecycle,
  to: OpportunityLifecycle,
): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Terminal states cannot be resurrected to OPEN — use explicit renew instead. */
export function isTerminalLifecycle(state: OpportunityLifecycle): boolean {
  return (
    state === "FULFILLED" || state === "EXPIRED" || state === "WITHDRAWN"
  );
}

export function isPubliclyListableLifecycle(
  state: OpportunityLifecycle,
): boolean {
  return (PUBLIC_ACTIVE_LIFECYCLES as readonly string[]).includes(state);
}
