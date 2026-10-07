/**
 * Source Bridge price for GBP Global Payouts agreements.
 * Seller entitlement is item + shipping + sourcer fee. The fee is added on top.
 * New agreements use a flat rate: 15% of the entire entitlement below £100,
 * or 11% of the entire entitlement at £100 or above. That is not a split.
 * Agreements already stored as GP_GBP_PROGRESSIVE_V1 keep that older schedule.
 * Thresholds are GBP minor units only. Do not reuse them in another currency.
 * Connect stays on calculateFees (7%). Release, inspection, retry, and return
 * must keep the stored fee and must not call this module.
 */

import { assertNonNegativeInt, roundBpsToMinor } from "@/lib/payments/money";
import { parseDestinationMinimums } from "@/lib/payments/payout-rail/live-pilot";

export const GP_GBP_PROGRESSIVE_V1 = "GP_GBP_PROGRESSIVE_V1";
export const GP_GBP_FLAT_V1 = "GP_GBP_FLAT_V1";

export const GP_GBP_FEE_EXPLANATION =
  "15% on the first \u00A3100, then 9% on the remaining amount.";

export const GP_GBP_FLAT_FEE_EXPLANATION =
  "15% of the entire seller amount below \u00A3100, or 11% of the entire seller amount at \u00A3100 or above. The threshold is the seller amount before the Source Bridge fee.";

/** £25 seller entitlement, in GBP minor units. */
export const GP_GBP_MINIMUM_ENTITLEMENT_MINOR = 2500;

/** £100 first-tier threshold, in GBP minor units. */
export const GP_GBP_TIER_THRESHOLD_MINOR = 10_000;

const FIRST_TIER_BPS = 1500;
const REST_BPS = 900;

export function feeExplanationForPolicy(policy: string | null | undefined): string {
  const id = String(policy || "");
  if (id === GP_GBP_PROGRESSIVE_V1) return GP_GBP_FEE_EXPLANATION;
  if (id === GP_GBP_FLAT_V1) return GP_GBP_FLAT_FEE_EXPLANATION;
  return "";
}

export function formatGbpMinor(minor: number): string {
  const safe = Math.max(0, Math.trunc(minor));
  const pounds = Math.trunc(safe / 100);
  const pence = String(safe % 100).padStart(2, "0");
  return `\u00A3${pounds}.${pence}`;
}

/**
 * Older progressive fee. Used only when an agreement already stores
 * GP_GBP_PROGRESSIVE_V1. A £200 entitlement on that schedule is £24.
 */
export function globalPayoutsGbpFeeMinor(entitlementMinor: number): number {
  const entitlement = assertNonNegativeInt(entitlementMinor, "entitlementMinor");
  const first = Math.min(entitlement, GP_GBP_TIER_THRESHOLD_MINOR);
  const rest = entitlement - first;
  return (
    roundBpsToMinor(first, FIRST_TIER_BPS) + roundBpsToMinor(rest, REST_BPS)
  );
}

const FLAT_BELOW_BPS = 1500;
const FLAT_AT_OR_ABOVE_BPS = 1100;

/**
 * Flat fee for a new GBP Global Payouts agreement.
 * Below £100, 15% of the entire entitlement. At £100 or above, 11% of the
 * entire entitlement. A £200 entitlement is £22. The buyer total drops at £100.
 */
export function globalPayoutsGbpFlatFeeMinor(entitlementMinor: number): number {
  const entitlement = assertNonNegativeInt(entitlementMinor, "entitlementMinor");
  const bps =
    entitlement < GP_GBP_TIER_THRESHOLD_MINOR ? FLAT_BELOW_BPS : FLAT_AT_OR_ABOVE_BPS;
  return roundBpsToMinor(entitlement, bps);
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
