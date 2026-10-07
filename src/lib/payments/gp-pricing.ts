/**
 * Approved Source Bridge price for NEW GBP Global Payouts agreements.
 * Seller entitlement is item + shipping + sourcer fee. The fee is added on top.
 * 15% of the first £100, then 9% of the remainder. Nearest minor unit.
 * Thresholds are GBP minor units only. Do not reuse them in another currency.
 * Connect stays on calculateFees (7%). Release, inspection, retry, and return
 * must keep the stored fee and must not call this module.
 */

import { assertNonNegativeInt, roundBpsToMinor } from "@/lib/payments/money";
import { parseDestinationMinimums } from "@/lib/payments/payout-rail/live-pilot";

export const GP_GBP_PROGRESSIVE_V1 = "GP_GBP_PROGRESSIVE_V1";

export const GP_GBP_FEE_EXPLANATION =
  "15% on the first \u00A3100, then 9% on the remaining amount.";

/** £25 seller entitlement, in GBP minor units. */
export const GP_GBP_MINIMUM_ENTITLEMENT_MINOR = 2500;

/** £100 first-tier threshold, in GBP minor units. */
export const GP_GBP_TIER_THRESHOLD_MINOR = 10_000;

const FIRST_TIER_BPS = 1500;
const REST_BPS = 900;

export function feeExplanationForPolicy(policy: string | null | undefined): string {
  return String(policy || "") === GP_GBP_PROGRESSIVE_V1 ? GP_GBP_FEE_EXPLANATION : "";
}

export function formatGbpMinor(minor: number): string {
  const safe = Math.max(0, Math.trunc(minor));
  const pounds = Math.trunc(safe / 100);
  const pence = String(safe % 100).padStart(2, "0");
  return `\u00A3${pounds}.${pence}`;
}

/**
 * Progressive platform fee for a GBP seller entitlement.
 * A £200 entitlement is £24, not 9% of the whole amount.
 */
export function globalPayoutsGbpFeeMinor(entitlementMinor: number): number {
  const entitlement = assertNonNegativeInt(entitlementMinor, "entitlementMinor");
  const first = Math.min(entitlement, GP_GBP_TIER_THRESHOLD_MINOR);
  const rest = entitlement - first;
  return (
    roundBpsToMinor(first, FIRST_TIER_BPS) + roundBpsToMinor(rest, REST_BPS)
  );
}

/**
 * GBP source floor. A higher GBP destination minimum raises it.
 * Minima in THB or any other currency are not converted and do not change this floor.
 * An unparsable minimum list fails closed.
 */
export function gpGbpEntitlementFloorMinor(destinationMinimumsRaw: string): number {
  const parsed = parseDestinationMinimums(destinationMinimumsRaw);
  if (!parsed.ok) {
    throw Object.assign(new Error("Destination payout minimums are not valid."), {
      status: 409,
      code: parsed.code,
    });
  }
  const gbp = parsed.minimums.GBP;
  if (typeof gbp === "number" && gbp > GP_GBP_MINIMUM_ENTITLEMENT_MINOR) return gbp;
  return GP_GBP_MINIMUM_ENTITLEMENT_MINOR;
}
