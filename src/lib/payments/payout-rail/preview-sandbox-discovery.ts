/**
 * Preview-only read-only discovery of the historical Sandbox GP fixture.
 * Stripe IDs stay server-side. Hash matches `_gp_e2e_sync_testingtesting.mjs` h8:
 * SHA-256 hex digest, first 8 characters, of String(value || "").
 */

import { createHash } from "node:crypto";
import { gpFetch } from "@/lib/payments/payout-rail/gp-client";
import {
  pickReadyPayoutMethodId,
  recipientBankCapabilityForCountry,
} from "@/lib/payments/payout-rail/recipient";

const RECIPIENT_PREFIX = "acct_1UHaY";
const RECIPIENT_H8 = "3525542e";
const PAYOUT_METHOD_PREFIX = "thba_test_61";
const PAYOUT_METHOD_H8 = "574fcb48";
const MAX_ACCOUNT_PAGES = 8;
const MAX_PAYOUT_METHOD_PAGES = 4;

export function discoveryHash8(value: string): string {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 8);
}

function testKeyKind(): "rk_test_" | "sk_test_" | null {
  const key = String(process.env.STRIPE_GP_RESTRICTED_KEY_TEST || "").trim();
  if (key.startsWith("rk_test_")) return "rk_test_";
  if (key.startsWith("sk_test_")) return "sk_test_";
  return null;
}

function initiationIsFalse(): boolean {
  const raw = String(process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED || "")
    .trim()
    .toLowerCase();
  return raw === "false" || raw === "0";
}

function stripeErrorCode(body: Record<string, unknown>): string | null {
  const err = body.error;
  if (!err || typeof err !== "object") return null;
  const record = err as { code?: unknown; type?: unknown };
  if (typeof record.code === "string" && record.code.length < 80) return record.code;
  if (typeof record.type === "string" && record.type.length < 80) return record.type;
  return null;
}

function livemodeIsFalse(raw: unknown): boolean | null {
  if (!raw || typeof raw !== "object" || !("livemode" in raw)) return null;
  return (raw as { livemode?: unknown }).livemode === false;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

function nextRelativePath(
  body: Record<string, unknown>,
  resourcePath: string,
): { path: string | null; rejected: boolean } {
  const direct = body.next_page_url;
  if (typeof direct === "string" && direct.length > 0) {
    if (!direct.startsWith(resourcePath) || direct.includes("://")) {
      return { path: null, rejected: true };
    }
    return { path: direct, rejected: false };
  }
  const token = body.next_page;
  if (token == null || token === "") {
    if (body.has_more === true) return { path: null, rejected: true };
    return { path: null, rejected: false };
  }
  if (typeof token !== "string" || token.length > 400 || token.includes("://")) {
    return { path: null, rejected: true };
  }
  return {
    path: `${resourcePath}?limit=20&page=${encodeURIComponent(token)}`,
    rejected: false,
  };
}

function dueCount(requirements: unknown): number {
  const req = asRecord(requirements);
  if (!req) return 0;
  const current = Array.isArray(req.currently_due) ? req.currently_due.length : 0;
  const past = Array.isArray(req.past_due) ? req.past_due.length : 0;
  return current + past;
}

function appStatus(opts: {
  payoutMethodReady: boolean;
  dueCount: number;
  stripeStatus: string;
}): string {
  if (opts.payoutMethodReady && opts.dueCount === 0) return "ACTIVE";
  if (opts.dueCount > 0) return "ACTION_REQUIRED";
  const status = opts.stripeStatus.toLowerCase();
  if (status === "rejected") return "REJECTED";
  if (status === "restricted") return "RESTRICTED";
  return "PENDING";
}

function blocked(error: string, extra: Record<string, unknown> = {}) {
  return {
    ok: false as const,
    error,
    ...extra,
    fixtureIds: null as { recipientId: string; payoutMethodId: string } | null,
    mutations: { stripe_writes: 0, db_writes: 0 },
  };
}

export async function discoverSandboxFixture() {
  const keyKind = testKeyKind();
  if (!keyKind) return blocked("test_key_unavailable");
  if (!initiationIsFalse()) return blocked("initiation_not_false");

  const accountIds: string[] = [];
  let prefixCount = 0;
  let path = "/v2/core/accounts?limit=20";
  const seen = new Set<string>();
  let pages = 0;
  let accountsComplete = false;

  while (pages < MAX_ACCOUNT_PAGES) {
    if (seen.has(path)) return blocked("account_pagination_repeated", { pages });
    seen.add(path);
    pages += 1;
    const page = await gpFetch({ mode: "TEST", method: "GET", path });
    if (!page.ok || !Array.isArray(page.body.data)) {
      return blocked("account_list_failed", {
        stripe_status: page.status,
        stripe_error_code: stripeErrorCode(page.body),
        pages,
      });
    }
    for (const raw of page.body.data) {
      const row = asRecord(raw);
      const id = typeof row?.id === "string" ? row.id : "";
      if (!id.startsWith(RECIPIENT_PREFIX)) continue;
      prefixCount += 1;
      if (discoveryHash8(id) === RECIPIENT_H8) accountIds.push(id);
    }
    const next = nextRelativePath(page.body, "/v2/core/accounts");
    if (next.rejected) {
      return blocked("account_pagination_rejected", {
        pages,
        prefix_match_count: prefixCount,
      });
    }
    if (!next.path) {
      accountsComplete = true;
      break;
    }
    path = next.path;
  }
  if (!accountsComplete) {
    return blocked("account_list_incomplete", {
      pages,
      prefix_match_count: prefixCount,
      prefix_and_hash_match_count: accountIds.length,
    });
  }
  if (accountIds.length !== 1) {
    return {
      ok: false as const,
      error: "recipient_match_count",
      hash: "sha256_hex_slice_0_8",
      key_kind: keyKind,
      initiation_is_false: true,
      accounts_complete: true,
      account_pages: pages,
      recipient: {
        prefix: RECIPIENT_PREFIX,
        expected_h8: RECIPIENT_H8,
        prefix_match_count: prefixCount,
        prefix_and_hash_match_count: accountIds.length,
      },
      fixtureIds: null,
      mutations: { stripe_writes: 0, db_writes: 0 },
    };
  }

  const recipientId = accountIds[0];
  const retrieved = await gpFetch({
    mode: "TEST",
    method: "GET",
    path: `/v2/core/accounts/${encodeURIComponent(recipientId)}?include=requirements&include=configuration.recipient&include=identity`,
  });
  if (!retrieved.ok) {
    return blocked("account_retrieve_failed", {
      stripe_status: retrieved.status,
      stripe_error_code: stripeErrorCode(retrieved.body),
    });
  }

  const identity = asRecord(retrieved.body.identity);
  const country =
    typeof identity?.country === "string" && /^[A-Z]{2}$/.test(identity.country)
      ? identity.country
      : null;
  const config = asRecord(retrieved.body.configuration);
  const recipientCfg = asRecord(config?.recipient);
  const requirements = recipientCfg?.requirements ?? retrieved.body.requirements;
  const due = dueCount(requirements);
  const preferWire = recipientBankCapabilityForCountry(country || "") === "wire";

  const methods: unknown[] = [];
  let methodPath = "/v2/money_management/payout_methods?limit=20";
  const seenMethods = new Set<string>();
  let methodPages = 0;
  let methodsComplete = false;
  while (methodPages < MAX_PAYOUT_METHOD_PAGES) {
    if (seenMethods.has(methodPath)) {
      return blocked("payout_method_pagination_repeated", { pages: methodPages });
    }
    seenMethods.add(methodPath);
    methodPages += 1;
    const page = await gpFetch({
      mode: "TEST",
      method: "GET",
      path: methodPath,
      stripeContext: recipientId,
    });
    if (!page.ok || !Array.isArray(page.body.data)) {
      return blocked("payout_method_list_failed", {
        stripe_status: page.status,
        stripe_error_code: stripeErrorCode(page.body),
        pages: methodPages,
      });
    }
    methods.push(...page.body.data);
    const next = nextRelativePath(page.body, "/v2/money_management/payout_methods");
    if (next.rejected) {
      return blocked("payout_method_pagination_rejected", { pages: methodPages });
    }
    if (!next.path) {
      methodsComplete = true;
      break;
    }
    methodPath = next.path;
  }
  if (!methodsComplete) {
    return blocked("payout_method_list_incomplete", { pages: methodPages });
  }

  let methodPrefixCount = 0;
  let methodHashCount = 0;
  let matchedMethod: Record<string, unknown> | null = null;
  for (const raw of methods) {
    const row = asRecord(raw);
    const id = typeof row?.id === "string" ? row.id : "";
    if (!id.startsWith(PAYOUT_METHOD_PREFIX)) continue;
    methodPrefixCount += 1;
    if (discoveryHash8(id) === PAYOUT_METHOD_H8) {
      methodHashCount += 1;
      matchedMethod = row;
    }
  }

  const selected = pickReadyPayoutMethodId(methods, { preferWire });
  const selectedId = selected?.id || "";
  const payoutMethodReady = Boolean(selected?.ready);
  const stripeStatus = typeof retrieved.body.status === "string" ? retrieved.body.status : "";
  const status = appStatus({
    payoutMethodReady,
    dueCount: due,
    stripeStatus,
  });
  const accountLivemodeFalse = livemodeIsFalse(retrieved.body);
  const methodLivemodeFalse = matchedMethod ? livemodeIsFalse(matchedMethod) : null;
  const bank = asRecord(matchedMethod?.bank_account);
  const methodCountry =
    typeof bank?.country === "string" && /^[A-Z]{2}$/.test(bank.country) ? bank.country : null;
  const usage = asRecord(matchedMethod?.usage_status);
  const transfers = typeof usage?.transfers === "string" ? usage.transfers : null;
  const payoutMethodId =
    matchedMethod && typeof matchedMethod.id === "string" ? matchedMethod.id : "";
  const livemodeExplicitlyLive =
    accountLivemodeFalse === false || methodLivemodeFalse === false;
  const ok = methodHashCount === 1 && !livemodeExplicitlyLive;

  return {
    ok,
    error: ok ? null : methodHashCount === 1 ? "livemode_not_false" : "payout_method_match_count",
    hash: "sha256_hex_slice_0_8",
    key_kind: keyKind,
    initiation_is_false: true,
    accounts_complete: true,
    account_pages: pages,
    payout_methods_complete: true,
    payout_method_pages: methodPages,
    recipient: {
      prefix: RECIPIENT_PREFIX,
      id_h8: discoveryHash8(recipientId),
      prefix_match_count: prefixCount,
      prefix_and_hash_match_count: 1,
      livemode_is_false: accountLivemodeFalse,
      country,
      app_status: status,
      payout_method_ready: payoutMethodReady,
      requirements_due_count: due,
      selected_ready_method_matches_historical:
        selectedId.startsWith(PAYOUT_METHOD_PREFIX) &&
        discoveryHash8(selectedId) === PAYOUT_METHOD_H8,
    },
    payout_method: {
      prefix: PAYOUT_METHOD_PREFIX,
      expected_h8: PAYOUT_METHOD_H8,
      prefix_match_count: methodPrefixCount,
      prefix_and_hash_match_count: methodHashCount,
      id_h8: matchedMethod ? PAYOUT_METHOD_H8 : null,
      livemode_is_false: methodLivemodeFalse,
      country: methodCountry,
      transfers,
      archived: Boolean(bank?.archived),
      scoped_by_stripe_context: true,
    },
    fixtureIds:
      ok && payoutMethodId
        ? { recipientId, payoutMethodId }
        : null,
    mutations: { stripe_writes: 0, db_writes: 0 },
  };
}

export async function runGpSandboxObjectDiscovery() {
  const full = await discoverSandboxFixture();
  const { fixtureIds: _ids, ...redacted } = full;
  void _ids;
  return redacted;
}
