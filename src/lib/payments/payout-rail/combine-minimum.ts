/**
 * Minimum-payout combine policy for Global Payouts.
 * Combines only compatible authorized entitlements: same sourcer, rail, currency.
 * Never combines protected/unauthorized amounts. Never loses entitlement rows.
 */

export type CombinableGpEntitlement = {
  attemptId: string;
  sellerId: string;
  currency: string;
  amountMinor: number;
  stripeMode: string;
  status: string;
};

export function groupCompatibleAwaitingMinimum(
  rows: CombinableGpEntitlement[],
): CombinableGpEntitlement[][] {
  const map = new Map<string, CombinableGpEntitlement[]>();
  for (const row of rows) {
    if (row.status !== "AWAITING_MINIMUM") continue;
    if (row.amountMinor <= 0) continue;
    const key = `${row.sellerId}|${row.stripeMode}|${row.currency.toUpperCase()}`;
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.values()].filter((g) => g.length > 0);
}

/** Alias used by release executor / admin queue. */
export const planCombineMinimumGroups = groupCompatibleAwaitingMinimum;

export function combinedAmountMinor(group: CombinableGpEntitlement[]): number {
  return group.reduce((sum, r) => sum + Math.max(0, r.amountMinor), 0);
}

/**
 * Whether a single AWAITING_MINIMUM row may auto-retry without multi-row combine.
 * Multi-row groups need admin-assisted combine (residual product decision).
 */
export function canAutoRetryAwaitingMinimumAlone(
  group: CombinableGpEntitlement[],
  attemptId: string,
): boolean {
  if (group.length !== 1) return false;
  return group[0]?.attemptId === attemptId;
}
