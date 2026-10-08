/**
 * Mocked LIVE financial-account diagnostic. No Stripe network and no database.
 * Run: node --experimental-strip-types scripts/test-gp-fa-live-diagnostic.ts
 */
import assert from "node:assert/strict";
import {
  authorizeLiveFaDiagnostic,
  handleLiveFaDiagnosticRequest,
  projectLiveFinancialAccountReport,
  retrieveConfiguredLiveFinancialAccount,
  type LiveFaDiagnosticReport,
} from "../src/lib/payments/payout-rail/fa-live-diagnostic.ts";

let passed = 0;
function ok(name: string, cond: unknown) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

const now = Date.parse("2026-10-08T10:00:00.000Z");
const token = "unit-test-token-not-a-credential";
const expires = String(now + 60_000);
const faId = "fa_live_unit_example";
const key = "rk_live_unit_example";

function authEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    presentedToken: token,
    configuredToken: token,
    expiresAtRaw: expires,
    sandboxRaw: "false",
    liveInitiationRaw: "false",
    nowMs: now,
    ...overrides,
  };
}

{
  const allowed = authorizeLiveFaDiagnostic(authEnv());
  ok("valid token before expiry is allowed", allowed.ok === true);
}

{
  const expired = authorizeLiveFaDiagnostic(authEnv({ nowMs: now + 60_001 }));
  ok("expired token is refused", !expired.ok && expired.errorCode === "GP_FA_DIAG_EXPIRED");
}

{
  const wrong = authorizeLiveFaDiagnostic(authEnv({ presentedToken: "other-token" }));
  ok("wrong token is refused", !wrong.ok && wrong.errorCode === "GP_FA_DIAG_UNAUTHORIZED");
}

{
  const missing = authorizeLiveFaDiagnostic(authEnv({ sandboxRaw: "" }));
  ok("missing sandbox flag is not explicit false", !missing.ok && missing.errorCode === "GP_FA_DIAG_INITIATION");
}

{
  const liveOn = authorizeLiveFaDiagnostic(authEnv({ liveInitiationRaw: "true" }));
  ok("live initiation true is refused", !liveOn.ok && liveOn.errorCode === "GP_FA_DIAG_INITIATION");
}

{
  let calls = 0;
  const retrieve = async (): Promise<LiveFaDiagnosticReport> => {
    calls += 1;
    throw new Error("should not run");
  };
  const denied = await handleLiveFaDiagnosticRequest({
    searchParams: [["account", faId]],
    contentLength: null,
    presentedToken: token,
    nowMs: now,
    env: { token, expiresAt: expires, sandbox: "false", liveInitiation: "false" },
    retrieve,
  });
  ok("client account id is refused", denied.status === 400 && denied.body.errorCode === "GP_FA_DIAG_INPUT");
  ok("rejected input does not call Stripe", calls === 0);
}

{
  let calls = 0;
  const blocked = await handleLiveFaDiagnosticRequest({
    searchParams: [],
    contentLength: "12",
    presentedToken: token,
    nowMs: now,
    env: { token, expiresAt: expires, sandbox: "false", liveInitiation: "false" },
    retrieve: async () => {
      calls += 1;
      throw new Error("should not run");
    },
  });
  ok("a request body is refused", blocked.status === 400 && calls === 0);
}

{
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.STRIPE_GP_RESTRICTED_KEY_LIVE;
  const previousFa = process.env.STRIPE_GP_FINANCIAL_ACCOUNT_ID_LIVE;
  const calls: Array<{ url: string; method: string; version: string; hasIdempotency: boolean }> = [];
  process.env.STRIPE_GP_RESTRICTED_KEY_LIVE = key;
  process.env.STRIPE_GP_FINANCIAL_ACCOUNT_ID_LIVE = faId;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      method: String(init?.method || "GET"),
      version: headers.get("Stripe-Version") || "",
      hasIdempotency: headers.has("Idempotency-Key"),
    });
    assert.equal(headers.get("Authorization"), `Bearer ${key}`);
    return new Response(
      JSON.stringify({
        id: faId,
        livemode: true,
        country: "gb",
        balance: { available: { gbp: { value: 2500, currency: "gbp" }, usd: { value: 1, currency: "usd" } } },
        secret: key,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const report = await retrieveConfiguredLiveFinancialAccount();
    ok("one GET uses the pinned preview version", calls.length === 1 && calls[0].method === "GET");
    ok(
      "GET targets only the configured account",
      calls[0].url === `https://api.stripe.com/v2/money_management/financial_accounts/${faId}`,
    );
    ok("Stripe version is 2026-08-26.preview", calls[0].version === "2026-08-26.preview");
    ok("the read sends no idempotency key", calls[0].hasIdempotency === false);
    ok("id matches", report.accountIdMatch === true);
    ok("livemode is true", report.livemode === true);
    ok("country is GB", report.country === "GB");
    ok("available GBP minor units are returned", report.availableGbpMinor === 2500);
    const encoded = JSON.stringify(report);
    ok("the report omits the account id and credential", !encoded.includes(faId) && !encoded.includes(key));
    ok(
      "the report has only safe fields",
      Object.keys(report).sort().join() ===
        "accountIdMatch,availableGbpMinor,country,errorCode,errorType,http,livemode,ok",
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.STRIPE_GP_RESTRICTED_KEY_LIVE;
    else process.env.STRIPE_GP_RESTRICTED_KEY_LIVE = previousKey;
    if (previousFa == null) delete process.env.STRIPE_GP_FINANCIAL_ACCOUNT_ID_LIVE;
    else process.env.STRIPE_GP_FINANCIAL_ACCOUNT_ID_LIVE = previousFa;
  }
}

{
  const report = projectLiveFinancialAccountReport({
    httpOk: false,
    httpStatus: 403,
    configuredAccountId: faId,
    body: {
      id: "fa_other",
      error: { code: "not_allowed", type: "invalid_request_error", message: `secret ${key} ${faId}` },
    },
  });
  ok("provider error keeps the status and safe code", report.http === 403 && report.errorCode === "not_allowed");
  ok("provider error omits the message", !JSON.stringify(report).includes(key) && !JSON.stringify(report).includes(faId));
  ok("a different id does not match", report.accountIdMatch === false);
}

console.log(`fa live diagnostic: ${passed} PASS`);
