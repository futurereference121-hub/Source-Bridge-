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
  inspectionHours: 48,
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
  let allowed: string[] = ["USD"];
  try {
    const parsed = JSON.parse(row.allowedCurrenciesJson || "[]") as unknown;
    if (Array.isArray(parsed)) {
      allowed = parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    allowed = ["USD"];
  }
  return {
    protectionFeeBps: row.protectionFeeBps,
    protectionFeeFloorMinor: row.protectionFeeFloorMinor,
    sellerServiceFeeBps: row.sellerServiceFeeBps,
    inspectionHours: row.inspectionHours,
    procurementMinTrustLevel: row.procurementMinTrustLevel,
    procurementAdvancesGloballyOn: row.procurementAdvancesGloballyOn,
    allowedCurrencies: allowed.length ? allowed : ["USD"],
    stripePlatformCountry: row.stripePlatformCountry || "",
  };
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
