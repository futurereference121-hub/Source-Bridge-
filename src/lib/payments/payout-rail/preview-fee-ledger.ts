/**
 * Read-only Preview retrieval of the labelled Sandbox quote, payment,
 * and the financial-account transactions linked by flow.outbound_payment.
 * GET only. The request cannot choose an ID or a database.
 */

import { prisma } from "@/lib/db";
import {
  STRIPE_GP_API_VERSION,
  getGlobalPayoutsFinancialAccountId,
  gpFetch,
} from "@/lib/payments/payout-rail/gp-client";
import { discoveryHash8 } from "@/lib/payments/payout-rail/preview-sandbox-discovery";
import {
  buildFeeLedgerEvidence,
  FEE_LEDGER_PAGE_CAP,
  platformTestKeyMayListLedger,
  safeProviderError,
  transactionLinkedToPayment,
} from "@/lib/payments/payout-rail/preview-fee-ledger-report";
import { SANDBOX_VERIFY_FIXTURE } from "@/lib/payments/payout-rail/preview-sandbox-verify-report";

const FIXTURE_TITLE = "GP_SANDBOX_E2E_FIXTURE_v1";
const PAGE_LIMIT = 100;

function previewHostH8(): string | null {
  const raw = String(process.env.DATABASE_URL || "").trim();
  if (!raw) return null;
  try {
    return discoveryHash8(new URL(raw.replace(/^postgresql:/, "postgres:")).hostname);
  } catch {
    return null;
  }
}

function initiationIsFalse(): boolean {
  const raw = String(process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED || "").trim().toLowerCase();
  return raw === "false" || raw === "0";
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function livemodeOf(body: Record<string, unknown> | null): boolean | null {
  return typeof body?.livemode === "boolean" ? body.livemode : null;
}

function nextListPath(next: unknown, allowedPrefix: string): string | null | "invalid" {
  if (next == null) return null;
  if (typeof next !== "string") return "invalid";
  const origin = "https://api.stripe.com";
  if (!next.startsWith(`${origin}${allowedPrefix}`)) return "invalid";
  return next.slice(origin.length);
}

type ListGetter = (path: string) => Promise<{
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}>;

async function restrictedGet(path: string) {
  return gpFetch({ mode: "TEST", method: "GET", path });
}

async function platformTestGet(path: string): Promise<{
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}> {
  const key = String(process.env.STRIPE_SECRET_KEY_TEST || "").trim();
  if (!key.startsWith("sk_test_")) return { ok: false, status: 0, body: {} };
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": STRIPE_GP_API_VERSION,
      Accept: "application/json",
    },
  });
  let body: Record<string, unknown> = {};
  try {
    const parsed = await res.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  return { ok: res.ok, status: res.status, body };
}

async function listGet(
  startPath: string,
  allowedPrefix: string,
  get: ListGetter = restrictedGet,
): Promise<{
  httpOk: boolean;
  complete: boolean;
  pages: number;
  rows: unknown[];
  error: { http_status: number; code: string | null; type: string | null } | null;
}> {
  const rows: unknown[] = [];
  let path = startPath;
  for (let page = 0; page < FEE_LEDGER_PAGE_CAP; page += 1) {
    const res = await get(path);
    if (!res.ok || !Array.isArray(res.body.data)) {
      return {
        httpOk: false,
        complete: false,
        pages: page + 1,
        rows,
        error: safeProviderError(res.status, res.body),
      };
    }
    rows.push(...res.body.data);
    const next = nextListPath(res.body.next_page_url, allowedPrefix);
    if (next === "invalid") {
      return { httpOk: true, complete: false, pages: page + 1, rows, error: null };
    }
    if (!next) return { httpOk: true, complete: true, pages: page + 1, rows, error: null };
    path = next;
  }
  return { httpOk: true, complete: false, pages: FEE_LEDGER_PAGE_CAP, rows, error: null };
}

function transactionQuery(filter: "both" | "flow" | "financial_account", faId: string, paymentId: string): string {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (filter === "both" || filter === "financial_account") params.set("financial_account", faId);
  if (filter === "both" || filter === "flow") params.set("flow", paymentId);
  return `/v2/money_management/transactions?${params.toString()}`;
}

export async function runSandboxFeeLedger(): Promise<Record<string, unknown>> {
  const hostH8 = previewHostH8();
  const initiation = initiationIsFalse();
  const deploymentCommit = String(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12);
  const base = {
    hostH8,
    initiationIsFalse: initiation,
    deploymentCommit,
    fixtureOk: false,
    blocker: "fixture_mismatch" as string | null,
    quoteId: "",
    paymentId: "",
    quoteOk: false,
    quoteLivemode: null as boolean | null,
    quoteBody: null as Record<string, unknown> | null,
    paymentOk: false,
    paymentLivemode: null as boolean | null,
    paymentBody: null as Record<string, unknown> | null,
    transactionList: {
      queried: false,
      filter: "none",
      httpOk: false,
      complete: false,
      pages: 0,
      rows: [] as unknown[],
      error: null,
      rejected_filters: [] as Array<{ filter: string; http_status: number; code: string | null; type: string | null }>,
    },
    entryList: {
      queried: false,
      httpOk: false,
      complete: false,
      pages: 0,
      groups: [] as Array<{ transactionId: string; rows: unknown[] }>,
    },
  };

  if (!initiation) return buildFeeLedgerEvidence({ ...base, blocker: "initiation_not_false" });
  if (hostH8 !== SANDBOX_VERIFY_FIXTURE.hostH8) {
    return buildFeeLedgerEvidence({ ...base, blocker: "database_host_mismatch" });
  }

  const fixtures = await prisma.protectedTransaction.findMany({
    where: { title: FIXTURE_TITLE },
    select: {
      id: true,
      stripeMode: true,
      currency: true,
      itemCostMinor: true,
    },
  });
  const txn = fixtures.length === 1 ? fixtures[0] : null;
  if (
    !txn ||
    discoveryHash8(txn.id) !== SANDBOX_VERIFY_FIXTURE.txnH8 ||
    txn.stripeMode !== "TEST" ||
    txn.itemCostMinor !== SANDBOX_VERIFY_FIXTURE.amountMinor ||
    txn.currency.toLowerCase() !== SANDBOX_VERIFY_FIXTURE.currency
  ) {
    return buildFeeLedgerEvidence({
      ...base,
      blocker: txn && txn.stripeMode !== "TEST" ? "not_test_mode" : "fixture_mismatch",
    });
  }

  const attempts = await prisma.outboundPaymentAttempt.findMany({
    where: { protectedTxnId: txn.id },
    select: { idempotencyKey: true, stripeOutboundPaymentId: true, fxRateSnapshot: true },
  });
  const corrected = attempts.filter((row) => row.idempotencyKey.endsWith("_quote_v1"));
  if (corrected.length !== 1) return buildFeeLedgerEvidence({ ...base, blocker: "corrected_attempt_count" });
  let quoteId = "";
  try {
    const snap = JSON.parse(corrected[0].fxRateSnapshot) as { quoteId?: unknown };
    quoteId = typeof snap.quoteId === "string" ? snap.quoteId : "";
  } catch {
    quoteId = "";
  }
  const paymentId = corrected[0].stripeOutboundPaymentId || "";
  if (!quoteId.startsWith("obpq_test_")) {
    return buildFeeLedgerEvidence({ ...base, blocker: "quote_missing", quoteId, paymentId });
  }
  if (!paymentId.startsWith("obp_test_")) {
    return buildFeeLedgerEvidence({ ...base, blocker: "payment_missing", quoteId, paymentId });
  }

  const quoteRes = await gpFetch({
    mode: "TEST",
    method: "GET",
    path: `/v2/money_management/outbound_payment_quotes/${encodeURIComponent(quoteId)}`,
  });
  const quoteBody = quoteRes.ok ? quoteRes.body : null;
  const quoteLivemode = livemodeOf(quoteBody);
  if (!quoteRes.ok || quoteBody?.id !== quoteId || quoteLivemode !== false) {
    return buildFeeLedgerEvidence({
      ...base,
      quoteId,
      paymentId,
      quoteOk: false,
      quoteLivemode,
      quoteBody,
      blocker: quoteLivemode === true ? "livemode_not_false" : "quote_unretrieved",
    });
  }

  const paymentRes = await gpFetch({
    mode: "TEST",
    method: "GET",
    path: `/v2/money_management/outbound_payments/${encodeURIComponent(paymentId)}`,
  });
  const paymentBody = paymentRes.ok ? paymentRes.body : null;
  const paymentLivemode = livemodeOf(paymentBody);
  if (!paymentRes.ok || paymentBody?.id !== paymentId || paymentLivemode !== false) {
    return buildFeeLedgerEvidence({
      ...base,
      fixtureOk: true,
      quoteId,
      paymentId,
      quoteOk: true,
      quoteLivemode,
      quoteBody,
      paymentOk: false,
      paymentLivemode,
      paymentBody,
      blocker: paymentLivemode === true ? "livemode_not_false" : "payment_unretrieved",
    });
  }

  const financialAccountId = getGlobalPayoutsFinancialAccountId("TEST");
  if (!financialAccountId.startsWith("fa_test_")) {
    return buildFeeLedgerEvidence({
      ...base,
      fixtureOk: true,
      quoteId,
      paymentId,
      quoteOk: true,
      quoteLivemode,
      quoteBody,
      paymentOk: true,
      paymentLivemode,
      paymentBody,
      blocker: "fa_not_test",
    });
  }

  const rejected: Array<{ filter: string; http_status: number; code: string | null; type: string | null }> = [];
  let listed = {
    httpOk: false,
    complete: false,
    pages: 0,
    rows: [] as unknown[],
    error: null as { http_status: number; code: string | null; type: string | null } | null,
  };
  let filterUsed = "none";
  for (const filter of ["both", "flow", "financial_account"] as const) {
    const result = await listGet(
      transactionQuery(filter, financialAccountId, paymentId),
      "/v2/money_management/transactions",
    );
    listed = result;
    filterUsed = filter;
    if (result.httpOk) break;
    if (result.error) rejected.push({ filter, ...result.error });
    if (result.error?.http_status !== 400 || result.error.code !== "invalid_filters") break;
  }
  let credential = "restricted_test";
  let platformKeyProof: {
    attempted: boolean;
    fa_retrieve_ok: boolean;
    fa_id_matches: boolean;
    livemode_false: boolean;
    used_for_list: boolean;
  } | null = null;
  if (
    !listed.httpOk &&
    listed.error?.http_status === 403 &&
    listed.error.code === "forbidden"
  ) {
    const proof = await platformTestGet(
      `/v2/money_management/financial_accounts/${encodeURIComponent(financialAccountId)}`,
    );
    const faIdMatches = proof.ok && proof.body.id === financialAccountId;
    const livemodeFalse = proof.body.livemode === false;
    const mayList = platformTestKeyMayListLedger({
      restrictedHttpStatus: listed.error.http_status,
      restrictedCode: listed.error.code,
      keyPrefixOk: String(process.env.STRIPE_SECRET_KEY_TEST || "").trim().startsWith("sk_test_"),
      retrievedIdMatches: faIdMatches,
      livemodeFalse,
    });
    platformKeyProof = {
      attempted: true,
      fa_retrieve_ok: proof.ok,
      fa_id_matches: faIdMatches,
      livemode_false: livemodeFalse,
      used_for_list: mayList,
    };
    if (mayList) {
      credential = "platform_test_secret_proven";
      rejected.length = 0;
      for (const filter of ["both", "flow", "financial_account"] as const) {
        const result = await listGet(
          transactionQuery(filter, financialAccountId, paymentId),
          "/v2/money_management/transactions",
          platformTestGet,
        );
        listed = result;
        filterUsed = filter;
        if (result.httpOk) break;
        if (result.error) rejected.push({ filter: `platform_${filter}`, ...result.error });
        if (result.error?.http_status !== 400 || result.error.code !== "invalid_filters") break;
      }
    }
  }
  const linkedIds = listed.rows
    .filter((row) => transactionLinkedToPayment(row, paymentId))
    .map((row) => {
      const id = asRecord(row)?.id;
      return typeof id === "string" && id.startsWith("trxn_") ? id : "";
    })
    .filter(Boolean);

  const groups: Array<{ transactionId: string; rows: unknown[] }> = [];
  let entryPages = 0;
  let entryHttpOk = true;
  let entryComplete = listed.complete;
  if (listed.httpOk) {
    for (const transactionId of linkedIds) {
      const entries = await listGet(
        `/v2/money_management/transaction_entries?transaction=${encodeURIComponent(transactionId)}&limit=${PAGE_LIMIT}`,
        "/v2/money_management/transaction_entries",
      );
      entryPages += entries.pages;
      groups.push({ transactionId, rows: entries.rows });
      if (!entries.httpOk) entryHttpOk = false;
      if (!entries.complete) entryComplete = false;
    }
  } else {
    entryComplete = false;
    entryHttpOk = false;
  }

  const blocker = !listed.httpOk
    ? "transaction_list_failed"
    : !listed.complete || !entryComplete
      ? "transaction_list_incomplete"
      : null;

  return buildFeeLedgerEvidence({
    hostH8,
    initiationIsFalse: initiation,
    deploymentCommit,
    fixtureOk: true,
    blocker,
    quoteId,
    paymentId,
    quoteOk: true,
    quoteLivemode,
    quoteBody,
    paymentOk: true,
    paymentLivemode,
    paymentBody,
    transactionList: {
      queried: true,
      filter: filterUsed,
      httpOk: listed.httpOk,
      complete: listed.complete,
      pages: listed.pages,
      rows: listed.rows,
      error: listed.httpOk ? null : listed.error,
      rejected_filters: rejected,
      credential,
      platform_key_proof: platformKeyProof,
    },
    entryList: {
      queried: listed.httpOk,
      httpOk: entryHttpOk,
      complete: entryComplete,
      pages: entryPages,
      groups,
    },
  });
}
