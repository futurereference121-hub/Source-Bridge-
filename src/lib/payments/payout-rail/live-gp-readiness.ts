/**
 * Read-only LIVE Global Payouts configuration snapshot.
 * GET only. Never creates quotes, payouts, transfers, or recipients.
 * Account ids are hashed. Secrets are never returned.
 */

import { createHash } from "node:crypto";
import {
  getGlobalPayoutsFinancialAccountId,
  gpFetch,
  hasGlobalPayoutsRestrictedKey,
} from "@/lib/payments/payout-rail/gp-client";
import { hasGlobalPayoutsWebhookSecret } from "@/lib/payments/payout-rail/webhook-verify";
import { interpretFinancialAccountBalance } from "@/lib/payments/payout-rail/fa-funding";
import { isGlobalPayoutsLiveInitiationEnabled } from "@/lib/payments/flags";
import { getStripe } from "@/lib/payments/stripe/client";
import { retrievedAccountLivemode } from "@/lib/payments/payout-rail/platform-bank-confirmation";

function hash8(value: string): string {
  if (!value) return "";
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function currencyKeys(body: Record<string, unknown>): string[] {
  const balance = body.balance && typeof body.balance === "object" ? (body.balance as Record<string, unknown>) : null;
  const available =
    balance?.available && typeof balance.available === "object" && !Array.isArray(balance.available)
      ? (balance.available as Record<string, unknown>)
      : null;
  return available ? Object.keys(available).map((k) => k.toUpperCase()).sort() : [];
}

export type LiveGpReadinessSnapshot = {
  liveInitiationEnabled: boolean;
  restrictedKeyPresent: boolean;
  financialAccountConfigured: boolean;
  financialAccountHash8: string;
  webhookSecretPresent: boolean;
  faReadAccess: "verified" | "denied" | "unconfigured" | "error";
  faLivemode: boolean | null;
  faStatus: string;
  faCurrencies: string[];
  gbpBalanceReadable: boolean;
  writePermissions: "unverified";
  eventDestinations: "verified" | "denied" | "unconfigured" | "error";
  eventDestinationCoversReceivedCredit: boolean | null;
  eventDestinationCoversOutbound: boolean | null;
  eventDestinationMatchesAppPath: boolean | null;
  platformReadAccess: "verified" | "denied" | "unconfigured" | "error";
  platformLivemode: boolean | null;
  platformAccountHash8: string;
  payoutScheduleInterval: string;
};

function emptySnapshot(partial: Partial<LiveGpReadinessSnapshot>): LiveGpReadinessSnapshot {
  return {
    liveInitiationEnabled: isGlobalPayoutsLiveInitiationEnabled(),
    restrictedKeyPresent: hasGlobalPayoutsRestrictedKey("LIVE"),
    financialAccountConfigured: Boolean(getGlobalPayoutsFinancialAccountId("LIVE")),
    financialAccountHash8: hash8(getGlobalPayoutsFinancialAccountId("LIVE")),
    webhookSecretPresent: hasGlobalPayoutsWebhookSecret("LIVE"),
    faReadAccess: "unconfigured",
    faLivemode: null,
    faStatus: "",
    faCurrencies: [],
    gbpBalanceReadable: false,
    writePermissions: "unverified",
    eventDestinations: "unconfigured",
    eventDestinationCoversReceivedCredit: null,
    eventDestinationCoversOutbound: null,
    eventDestinationMatchesAppPath: null,
    platformReadAccess: "unconfigured",
    platformLivemode: null,
    platformAccountHash8: "",
    payoutScheduleInterval: "",
    ...partial,
  };
}

async function readPlatformAccount(): Promise<{
  platformReadAccess: LiveGpReadinessSnapshot["platformReadAccess"];
  platformLivemode: boolean | null;
  platformAccountHash8: string;
  payoutScheduleInterval: string;
}> {
  try {
    const account = await getStripe("LIVE").accounts.retrieve();
    const interval = account.settings?.payouts?.schedule?.interval;
    return {
      platformReadAccess: "verified",
      platformLivemode: retrievedAccountLivemode(account as object),
      platformAccountHash8: hash8(account.id || ""),
      payoutScheduleInterval: typeof interval === "string" ? interval.slice(0, 20) : "",
    };
  } catch (err) {
    const status =
      err && typeof err === "object" && "statusCode" in err
        ? Number((err as { statusCode?: number }).statusCode)
        : 0;
    const message = err instanceof Error ? err.message : "";
    const denied = status === 401 || status === 403 || /invalid api key|permission/i.test(message);
    const unconfigured = /not configured|secret/i.test(message);
    return {
      platformReadAccess: denied ? "denied" : unconfigured ? "unconfigured" : "error",
      platformLivemode: null,
      platformAccountHash8: "",
      payoutScheduleInterval: "",
    };
  }
}

export async function readLiveGpAccountReadiness(): Promise<LiveGpReadinessSnapshot> {
  const faId = getGlobalPayoutsFinancialAccountId("LIVE");
  const keyPresent = hasGlobalPayoutsRestrictedKey("LIVE");
  const platform = await readPlatformAccount();
  if (!keyPresent) {
    return emptySnapshot({
      ...platform,
      restrictedKeyPresent: false,
      financialAccountConfigured: Boolean(faId),
      faReadAccess: "unconfigured",
      eventDestinations: "unconfigured",
    });
  }
  if (!faId) {
    return emptySnapshot({
      ...platform,
      financialAccountConfigured: false,
      faReadAccess: "unconfigured",
    });
  }

  let faReadAccess: LiveGpReadinessSnapshot["faReadAccess"] = "error";
  let faLivemode: boolean | null = null;
  let faStatus = "";
  let faCurrencies: string[] = [];
  let gbpBalanceReadable = false;
  try {
    const res = await gpFetch({
      mode: "LIVE",
      method: "GET",
      path: `/v2/money_management/financial_accounts/${encodeURIComponent(faId)}`,
      moneyMutation: false,
    });
    if (res.status === 401 || res.status === 403) {
      faReadAccess = "denied";
    } else if (res.ok) {
      faReadAccess = "verified";
      faLivemode = typeof res.body.livemode === "boolean" ? res.body.livemode : null;
      faStatus = typeof res.body.status === "string" ? res.body.status.slice(0, 40) : "";
      faCurrencies = currencyKeys(res.body);
      const gbp = interpretFinancialAccountBalance({
        body: res.body,
        currency: "gbp",
        configuredAccountId: faId,
        mode: "LIVE",
        httpOk: res.ok,
        httpStatus: res.status,
      });
      gbpBalanceReadable = Boolean(gbp.rawOk);
    } else {
      faReadAccess = "error";
    }
  } catch {
    faReadAccess = "error";
  }

  let eventDestinations: LiveGpReadinessSnapshot["eventDestinations"] = "error";
  let eventDestinationCoversReceivedCredit: boolean | null = null;
  let eventDestinationCoversOutbound: boolean | null = null;
  let eventDestinationMatchesAppPath: boolean | null = null;
  try {
    const listed = await gpFetch({
      mode: "LIVE",
      method: "GET",
      path: "/v2/core/event_destinations?limit=10",
      moneyMutation: false,
    });
    if (listed.status === 401 || listed.status === 403) {
      eventDestinations = "denied";
    } else if (listed.ok && Array.isArray(listed.body.data)) {
      eventDestinations = "verified";
      const blob = JSON.stringify(listed.body.data).toLowerCase();
      eventDestinationCoversReceivedCredit = blob.includes("received_credit");
      eventDestinationCoversOutbound = blob.includes("outbound_payment");
      eventDestinationMatchesAppPath = blob.includes("global-payouts");
    } else {
      eventDestinations = "error";
    }
  } catch {
    eventDestinations = "error";
  }

  return emptySnapshot({
    ...platform,
    faReadAccess,
    faLivemode,
    faStatus,
    faCurrencies,
    gbpBalanceReadable,
    eventDestinations,
    eventDestinationCoversReceivedCredit,
    eventDestinationCoversOutbound,
    eventDestinationMatchesAppPath,
  });
}
