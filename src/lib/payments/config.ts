import { prisma } from "@/lib/db";
import type { FeeConfig } from "@/lib/payments/fees";

export type PlatformConfig = FeeConfig & {
  inspectionHours: number;
  procurementMinTrustLevel: number;
  procurementAdvancesGloballyOn: boolean;
  allowedCurrencies: string[];
  stripePlatformCountry: string;
};

const DEFAULTS: PlatformConfig = {
  protectionFeeBps: 350,
  protectionFeeFloorMinor: 50,
  sellerServiceFeeBps: 0,
  // Separate Direct service fee (not Protection Fee). Defaults match protection rates;
  // admin/config can diverge later without hardcoding checkout amounts.
  directServiceFeeBps: 350,
  directServiceFeeFloorMinor: 50,
  inspectionHours: 12,
  procurementMinTrustLevel: 2,
  procurementAdvancesGloballyOn: true,
  allowedCurrencies: ["USD"],
  stripePlatformCountry: "",
};

export async function getPlatformPaymentConfig(): Promise<PlatformConfig> {
  const row = await prisma.platformPaymentConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
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
  // Prefer DB columns when present (migration added); else env overrides; else DEFAULTS.
  // Avoid hardcoding 70¢ checkout amounts — floors come from config.
  const directBps = readOptionalInt(
    (row as { directServiceFeeBps?: number }).directServiceFeeBps,
    envInt("DIRECT_SERVICE_FEE_BPS", DEFAULTS.directServiceFeeBps),
  );
  const directFloor = readOptionalInt(
    (row as { directServiceFeeFloorMinor?: number }).directServiceFeeFloorMinor,
    envInt("DIRECT_SERVICE_FEE_FLOOR_MINOR", DEFAULTS.directServiceFeeFloorMinor),
  );
  return {
    protectionFeeBps: row.protectionFeeBps,
    protectionFeeFloorMinor: row.protectionFeeFloorMinor,
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
