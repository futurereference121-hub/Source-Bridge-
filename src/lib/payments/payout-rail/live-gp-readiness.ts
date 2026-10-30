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
import {
  RECEIVED_CREDITS_LIST_PATH,
  receivedCreditsListPath,
} from "@/lib/payments/payout-rail/received-credits";

export const LIVE_GP_WEBHOOK_PATH = "/api/webhooks/stripe/global-payouts";
const LIVE_GP_WEBHOOK_HOST = "sourcebridge.app";
const EVENT_DESTINATION_URL_INCLUDE = "include[0]=webhook_endpoint.url";
const EVENT_DESTINATION_LIST_PATH = `/v2/core/event_destinations?limit=100&${EVENT_DESTINATION_URL_INCLUDE}`;

/** Pinned 2026-08-26.preview thin events the LIVE GP destination must send. */
export const REQUIRED_LIVE_GP_OUTBOUND_EVENTS = [
  "v2.money_management.outbound_payment.created",
  "v2.money_management.outbound_payment.posted",
  "v2.money_management.outbound_payment.failed",
  "v2.money_management.outbound_payment.returned",
  "v2.money_management.outbound_payment.canceled",
  "v2.money_management.outbound_payment.updated",
  "v2.money_management.outbound_payment.under_review",
] as const;

export const REQUIRED_LIVE_GP_RECEIVED_CREDIT_EVENTS = [
  "v2.money_management.received_credit.available",
  "v2.money_management.received_credit.failed",
  "v2.money_management.received_credit.returned",
  "v2.money_management.received_credit.succeeded",
] as const;

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
  gbpAvailableMinor: number | null;
  writePermissions: "unverified";
  eventDestinations: "verified" | "denied" | "unconfigured" | "error";
  eventDestinationUrlRead: "verified" | "redacted" | "denied" | "unconfigured" | "error" | null;
  eventDestinationLiveCount: number | null;
  eventDestinationCoversReceivedCredit: boolean | null;
  eventDestinationCoversOutbound: boolean | null;
  eventDestinationMatchesAppPath: boolean | null;
  receivedCreditsReadAccess: "verified" | "denied" | "unconfigured" | "error";
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
    gbpAvailableMinor: null,
    writePermissions: "unverified",
    eventDestinations: "unconfigured",
    eventDestinationUrlRead: null,
    eventDestinationLiveCount: null,
    eventDestinationCoversReceivedCredit: null,
    eventDestinationCoversOutbound: null,
    eventDestinationMatchesAppPath: null,
    receivedCreditsReadAccess: "unconfigured",
    platformReadAccess: "unconfigured",
    platformLivemode: null,
    platformAccountHash8: "",
    payoutScheduleInterval: "",
    ...partial,
  };
}

function destinationUrl(row: Record<string, unknown>): string {
  const endpoint =
    row.webhook_endpoint && typeof row.webhook_endpoint === "object"
      ? (row.webhook_endpoint as Record<string, unknown>)
      : null;
  return typeof endpoint?.url === "string" ? endpoint.url.trim() : "";
}

function destinationEvents(row: Record<string, unknown>): string[] {
  const raw = Array.isArray(row.enabled_events)
    ? row.enabled_events
    : Array.isArray(row.event_types)
      ? row.event_types
      : [];
  return raw.map((event) => String(event || "").trim().toLowerCase()).filter(Boolean);
}

function destinationEnabled(row: Record<string, unknown>): boolean {
  const status = String(row.status || "enabled").trim().toLowerCase();
  return status !== "disabled";
}

function liveDestinationRows(destinations: unknown[]): Record<string, unknown>[] {
  const rows = destinations.filter((row): row is Record<string, unknown> => {
    return Boolean(row && typeof row === "object");
  });
  const live = rows.filter((row) => row.livemode === true);
  if (live.length > 0) return live;
  // LIVE-key list with omitted livemode is not proof of an empty LIVE set.
  return rows.filter((row) => typeof row.livemode !== "boolean");
}

function urlMatchesAppPath(url: string): boolean {
  const value = url.toLowerCase();
  return value.includes(LIVE_GP_WEBHOOK_HOST) && value.includes(LIVE_GP_WEBHOOK_PATH);
}

export function destinationSubscribesTo(
  subscribed: string[],
  required: readonly string[],
): boolean {
  const events = subscribed.map((event) => String(event || "").trim().toLowerCase());
  if (events.includes("*")) return true;
  return required.every((need) => {
    const want = need.toLowerCase();
    if (events.includes(want)) return true;
    const family = want.replace(/\.[^.]+$/, "");
    return events.includes(family) || events.includes(`${family}.*`);
  });
}

export function inspectListedEventDestinations(destinations: unknown[]): {
  liveCount: number;
  urlRead: "verified" | "redacted";
  matchesAppPath: boolean | null;
  coversReceivedCredit: boolean | null;
  coversOutbound: boolean | null;
} {
  const live = liveDestinationRows(destinations);
  if (live.length === 0) {
    return {
      liveCount: 0,
      urlRead: "verified",
      matchesAppPath: false,
      coversReceivedCredit: false,
      coversOutbound: false,
    };
  }
  const readable = live.filter((row) => destinationUrl(row));
  const urlRead = readable.length > 0 ? "verified" : "redacted";
  const matching = urlRead === "verified" ? live.filter((row) => urlMatchesAppPath(destinationUrl(row))) : [];
  const scoped =
    urlRead === "verified"
      ? matching.filter(destinationEnabled)
      : live.filter(destinationEnabled);
  const events = scoped.flatMap(destinationEvents);
  return {
    liveCount: live.length,
    urlRead,
    matchesAppPath: urlRead === "redacted" ? null : matching.length > 0,
    coversReceivedCredit:
      urlRead === "redacted" && scoped.length === 0
        ? null
        : destinationSubscribesTo(events, REQUIRED_LIVE_GP_RECEIVED_CREDIT_EVENTS),
    coversOutbound:
      urlRead === "redacted" && scoped.length === 0
        ? null
        : destinationSubscribesTo(events, REQUIRED_LIVE_GP_OUTBOUND_EVENTS),
  };
}

function nextEventDestinationPath(nextPageUrl: string): string | null {
  const raw = nextPageUrl.trim();
  if (!raw) return null;
  const path = raw.startsWith("https://api.stripe.com/")
    ? raw.slice("https://api.stripe.com".length)
    : raw.startsWith("/")
      ? raw
      : null;
  if (!path || path.includes("signing_secret")) return null;
  if (path.includes("webhook_endpoint.url")) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${EVENT_DESTINATION_URL_INCLUDE}`;
}

async function listLiveEventDestinations(): Promise<{
  access: LiveGpReadinessSnapshot["eventDestinations"];
  destinations: unknown[];
}> {
  const destinations: unknown[] = [];
  let path: string | null = EVENT_DESTINATION_LIST_PATH;
  for (let page = 0; page < 10 && path; page += 1) {
    const listed = await gpFetch({
      mode: "LIVE",
      method: "GET",
      path,
      moneyMutation: false,
    });
    if (listed.status === 401 || listed.status === 403) {
      return { access: "denied", destinations };
    }
    if (!listed.ok || !Array.isArray(listed.body.data)) {
      if (page === 0 && path.includes("include[")) {
        path = "/v2/core/event_destinations?limit=100";
        continue;
      }
      return { access: page === 0 ? "error" : "verified", destinations };
    }
    destinations.push(...listed.body.data);
    const next = typeof listed.body.next_page_url === "string" ? listed.body.next_page_url : "";
    path = nextEventDestinationPath(next);
  }
  return { access: "verified", destinations };
}

async function readReceivedCreditsAccess(): Promise<
  LiveGpReadinessSnapshot["receivedCreditsReadAccess"]
> {
  try {
    let listed = await gpFetch({
      mode: "LIVE",
      method: "GET",
      path: receivedCreditsListPath({ limit: 1 }),
      moneyMutation: false,
    });
    if (listed.status === 401 || listed.status === 403) return "denied";
    if (!listed.ok && listed.status >= 400 && listed.status < 500) {
      listed = await gpFetch({
        mode: "LIVE",
        method: "GET",
        path: RECEIVED_CREDITS_LIST_PATH,
        moneyMutation: false,
      });
    }
    if (listed.status === 401 || listed.status === 403) return "denied";
    if (!listed.ok) return "error";
    return "verified";
  } catch {
    return "error";
  }
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
  let gbpAvailableMinor: number | null = null;
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
      gbpAvailableMinor = gbp.rawOk ? gbp.availableMinor : null;
    } else {
      faReadAccess = "error";
    }
  } catch {
    faReadAccess = "error";
  }

  let eventDestinations: LiveGpReadinessSnapshot["eventDestinations"] = "error";
  let eventDestinationUrlRead: LiveGpReadinessSnapshot["eventDestinationUrlRead"] = null;
  let eventDestinationLiveCount: number | null = null;
  let eventDestinationCoversReceivedCredit: boolean | null = null;
  let eventDestinationCoversOutbound: boolean | null = null;
  let eventDestinationMatchesAppPath: boolean | null = null;
  try {
    const listed = await listLiveEventDestinations();
    eventDestinations = listed.access;
    if (listed.access === "denied") {
      eventDestinationUrlRead = "denied";
    } else if (listed.access === "verified") {
      const inspected = inspectListedEventDestinations(listed.destinations);
      eventDestinationUrlRead = inspected.urlRead;
      eventDestinationLiveCount = inspected.liveCount;
      eventDestinationCoversReceivedCredit = inspected.coversReceivedCredit;
      eventDestinationCoversOutbound = inspected.coversOutbound;
      eventDestinationMatchesAppPath = inspected.matchesAppPath;
    }
  } catch {
    eventDestinations = "error";
    eventDestinationUrlRead = "error";
  }

  const receivedCreditsReadAccess = await readReceivedCreditsAccess();

  return emptySnapshot({
    ...platform,
    faReadAccess,
    faLivemode,
    faStatus,
    faCurrencies,
    gbpBalanceReadable,
    gbpAvailableMinor,
    eventDestinations,
    eventDestinationUrlRead,
    eventDestinationLiveCount,
    eventDestinationCoversReceivedCredit,
    eventDestinationCoversOutbound,
    eventDestinationMatchesAppPath,
    receivedCreditsReadAccess,
  });
}
