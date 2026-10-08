/**
 * Temporary read-only LIVE financial-account diagnostic.
 * One configured-account GET. No client account id, mode, amount, or provider URL.
 * Credentials stay in the server environment and are never returned.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/** Same pinned preview header as gp-client. This diagnostic never POSTs. */
const STRIPE_GP_API_VERSION = "2026-08-26.preview";

export const FA_DIAG_HEADER = "x-sb-fa-diag-token";

const SAFE_TOKEN = /^[a-z0-9_]{1,64}$/i;

export type LiveFaDiagnosticReport = {
  http: number;
  ok: boolean;
  accountIdMatch: boolean;
  livemode: boolean | null;
  country: string | null;
  availableGbpMinor: number | null;
  errorCode: string | null;
  errorType: string | null;
};

export type FaDiagDecision =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403; errorCode: string };

const FORBIDDEN_INPUT = new Set([
  "account",
  "accountid",
  "financialaccount",
  "financial_account",
  "mode",
  "stripemode",
  "stripe_mode",
  "amount",
  "url",
  "providerurl",
  "provider_url",
]);

export function explicitlyFalse(raw: string | undefined): boolean {
  return String(raw ?? "").trim().toLowerCase() === "false";
}

function tokensMatch(presented: string, configured: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(configured).digest();
  return timingSafeEqual(a, b);
}

export function authorizeLiveFaDiagnostic(opts: {
  presentedToken: string | null;
  configuredToken: string | undefined;
  expiresAtRaw: string | undefined;
  sandboxRaw: string | undefined;
  liveInitiationRaw: string | undefined;
  nowMs: number;
}): FaDiagDecision {
  if (!explicitlyFalse(opts.sandboxRaw) || !explicitlyFalse(opts.liveInitiationRaw)) {
    return { ok: false, status: 403, errorCode: "GP_FA_DIAG_INITIATION" };
  }
  const configured = String(opts.configuredToken || "");
  const expiresAt = Number(String(opts.expiresAtRaw || "").trim());
  if (!configured || !Number.isFinite(expiresAt)) {
    return { ok: false, status: 401, errorCode: "GP_FA_DIAG_UNAVAILABLE" };
  }
  if (opts.nowMs > expiresAt) {
    return { ok: false, status: 401, errorCode: "GP_FA_DIAG_EXPIRED" };
  }
  if (!tokensMatch(String(opts.presentedToken || ""), configured)) {
    return { ok: false, status: 401, errorCode: "GP_FA_DIAG_UNAUTHORIZED" };
  }
  return { ok: true };
}

export function diagnosticRequestRejected(
  searchParams: Iterable<[string, string]>,
  contentLength: string | null,
): boolean {
  if (contentLength && contentLength !== "0") return true;
  for (const [key] of searchParams) {
    if (FORBIDDEN_INPUT.has(key.trim().toLowerCase())) return true;
  }
  return false;
}

function safeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return SAFE_TOKEN.test(token) ? token : null;
}

function emptyReport(http: number, errorCode: string | null): LiveFaDiagnosticReport {
  return {
    http,
    ok: false,
    accountIdMatch: false,
    livemode: null,
    country: null,
    availableGbpMinor: null,
    errorCode,
    errorType: null,
  };
}

export function projectLiveFinancialAccountReport(opts: {
  httpOk: boolean;
  httpStatus: number;
  body: Record<string, unknown>;
  configuredAccountId: string;
}): LiveFaDiagnosticReport {
  const err = opts.body.error;
  const errRec = err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const countryRaw = opts.body.country;
  const country =
    typeof countryRaw === "string" && /^[a-z]{2}$/i.test(countryRaw.trim())
      ? countryRaw.trim().toUpperCase()
      : null;
  const livemode = typeof opts.body.livemode === "boolean" ? opts.body.livemode : null;
  const responseId = typeof opts.body.id === "string" ? opts.body.id.trim() : "";
  const configured = opts.configuredAccountId.trim();
  const balance =
    opts.body.balance && typeof opts.body.balance === "object"
      ? (opts.body.balance as Record<string, unknown>)
      : null;
  const available =
    balance?.available && typeof balance.available === "object" && !Array.isArray(balance.available)
      ? (balance.available as Record<string, unknown>)
      : null;
  const gbp =
    available?.gbp && typeof available.gbp === "object" && !Array.isArray(available.gbp)
      ? (available.gbp as Record<string, unknown>)
      : null;
  const gbpCurrency = typeof gbp?.currency === "string" ? gbp.currency.trim().toLowerCase() : "";
  const gbpValue = gbp?.value;
  const availableGbpMinor =
    gbpCurrency === "gbp" && typeof gbpValue === "number" && Number.isSafeInteger(gbpValue) && gbpValue >= 0
      ? gbpValue
      : null;

  return {
    http: opts.httpStatus,
    ok: opts.httpOk,
    accountIdMatch: Boolean(configured) && responseId === configured,
    livemode,
    country,
    availableGbpMinor,
    errorCode: safeToken(errRec?.code),
    errorType: safeToken(errRec?.type),
  };
}

/** GET the saved LIVE financial account. The path is not taken from the client. */
export async function retrieveConfiguredLiveFinancialAccount(): Promise<LiveFaDiagnosticReport> {
  const faId = String(process.env.STRIPE_GP_FINANCIAL_ACCOUNT_ID_LIVE || "").trim();
  const key = String(process.env.STRIPE_GP_RESTRICTED_KEY_LIVE || "").trim();
  if (!faId || !key) return emptyReport(0, "GP_FA_NOT_CONFIGURED");
  const path = `/v2/money_management/financial_accounts/${encodeURIComponent(faId)}`;
  let response: Response;
  try {
    response = await fetch(`https://api.stripe.com${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        "Stripe-Version": STRIPE_GP_API_VERSION,
        Accept: "application/json",
      },
    });
  } catch {
    return emptyReport(0, "GP_FA_DIAG_FAILED");
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return projectLiveFinancialAccountReport({
    httpOk: response.ok,
    httpStatus: response.status,
    body,
    configuredAccountId: faId,
  });
}

export async function handleLiveFaDiagnosticRequest(opts: {
  searchParams: Iterable<[string, string]>;
  contentLength: string | null;
  presentedToken: string | null;
  nowMs: number;
  env: {
    token?: string;
    expiresAt?: string;
    sandbox?: string;
    liveInitiation?: string;
  };
  retrieve?: () => Promise<LiveFaDiagnosticReport>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (diagnosticRequestRejected(opts.searchParams, opts.contentLength)) {
    return { status: 400, body: { ok: false, errorCode: "GP_FA_DIAG_INPUT" } };
  }
  const auth = authorizeLiveFaDiagnostic({
    presentedToken: opts.presentedToken,
    configuredToken: opts.env.token,
    expiresAtRaw: opts.env.expiresAt,
    sandboxRaw: opts.env.sandbox,
    liveInitiationRaw: opts.env.liveInitiation,
    nowMs: opts.nowMs,
  });
  if (!auth.ok) {
    return { status: auth.status, body: { ok: false, errorCode: auth.errorCode } };
  }
  const retrieve = opts.retrieve ?? retrieveConfiguredLiveFinancialAccount;
  try {
    const report = await retrieve();
    return { status: 200, body: report };
  } catch {
    return { status: 200, body: emptyReport(0, "GP_FA_DIAG_FAILED") };
  }
}
