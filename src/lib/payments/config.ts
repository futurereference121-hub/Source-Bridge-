import { prisma } from "@/lib/db";
import type { FeeConfig } from "@/lib/payments/fees";

/**
 * Authoritative Source Bridge platform fee rate.
 * 200 bps = 2%. Used for Protected + Direct product and sourcing tickets.
 * Fee base = itemCost + shipping (never seller/sourcer service fee).
 */
export const SOURCE_BRIDGE_FEE_BPS = 200;

/**
 * Minimum platform fee in minor units. Product decision is pure 2% (no minimum).
 * Historical default was 50 (at 3.5%); zeroed so $20 → $0.40.
 */
export const SOURCE_BRIDGE_FEE_FLOOR_MINOR = 0;

export type PlatformConfig = FeeConfig & {
  inspectionHours: number;
  procurementMinTrustLevel: number;
  procurementAdvancesGloballyOn: boolean;
  allowedCurrencies: string[];
  stripePlatformCountry: string;
};

const DEFAULTS: PlatformConfig = {
  protectionFeeBps: SOURCE_BRIDGE_FEE_BPS,
  protectionFeeFloorMinor: SOURCE_BRIDGE_FEE_FLOOR_MINOR,
  sellerServiceFeeBps: 0,
  // Direct service fee shares the same Source Bridge rate; admin can diverge later.
  directServiceFeeBps: SOURCE_BRIDGE_FEE_BPS,
  directServiceFeeFloorMinor: SOURCE_BRIDGE_FEE_FLOOR_MINOR,
  inspectionHours: 12,
  procurementMinTrustLevel: 2,
  procurementAdvancesGloballyOn: true,
  allowedCurrencies: ["USD"],
  stripePlatformCountry: "",
};

export async function getPlatformPaymentConfig(): Promise<PlatformConfig> {
  const row = await prisma.platformPaymentConfig.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      protectionFeeBps: DEFAULTS.protectionFeeBps,
      protectionFeeFloorMinor: DEFAULTS.protectionFeeFloorMinor,
      directServiceFeeBps: DEFAULTS.directServiceFeeBps,
      directServiceFeeFloorMinor: DEFAULTS.directServiceFeeFloorMinor,
    },
    update: {},
  });
  let allowed: string[] = ["USD", "GBP"];
  try {
    const parsed = JSON.parse(row.allowedCurrenciesJson || "[]") as unknown;
    if (Array.isArray(parsed)) {
      allowed = parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    allowed = ["USD", "GBP"];
  }
  // Always permit TEST ramp currencies (do not require a DB migration).
  const merged = Array.from(
    new Set([...(allowed.length ? allowed : ["USD"]), "USD", "GBP"].map((c) => c.toUpperCase())),
  );
  // Prefer DB columns when present; else env overrides; else DEFAULTS.
  // SOURCE_BRIDGE_FEE_BPS env can force both rates in TEST without a DB edit.
  const sharedBps = envInt("SOURCE_BRIDGE_FEE_BPS", DEFAULTS.protectionFeeBps);
  const sharedFloor = envInt(
    "SOURCE_BRIDGE_FEE_FLOOR_MINOR",
    DEFAULTS.protectionFeeFloorMinor,
  );
  const directBps = readOptionalInt(
    (row as { directServiceFeeBps?: number }).directServiceFeeBps,
    envInt("DIRECT_SERVICE_FEE_BPS", sharedBps),
  );
  const directFloor = readOptionalInt(
    (row as { directServiceFeeFloorMinor?: number }).directServiceFeeFloorMinor,
    envInt("DIRECT_SERVICE_FEE_FLOOR_MINOR", sharedFloor),
  );
  return {
    protectionFeeBps: readOptionalInt(row.protectionFeeBps, sharedBps),
    protectionFeeFloorMinor: readOptionalInt(
      row.protectionFeeFloorMinor,
      sharedFloor,
    ),
    sellerServiceFeeBps: row.sellerServiceFeeBps,
    directServiceFeeBps: directBps,
    directServiceFeeFloorMinor: directFloor,
    inspectionHours: row.inspectionHours,
    procurementMinTrustLevel: row.procurementMinTrustLevel,
    procurementAdvancesGloballyOn: row.procurementAdvancesGloballyOn,
    allowedCurrencies: merged,
    stripePlatformCountry: row.stripePlatformCountry || "",
  };
}

function readOptionalInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = (process.env[name] || "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function assertCurrencyAllowed(
  currency: string,
  config: PlatformConfig,
): void {
  const c = currency.toUpperCase();
  if (!config.allowedCurrencies.map((x) => x.toUpperCase()).includes(c)) {
    throw Object.assign(new Error(`Currency ${c} is not enabled`), {
      status: 400,
      code: "CURRENCY_NOT_ALLOWED",
    });
  }
}
