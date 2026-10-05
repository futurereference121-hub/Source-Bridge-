/**
 * TEST Global Payouts release through the real routes.
 * Auth, database, and Stripe are in-memory doubles. No network, no Production
 * database, and no remote quote or payout.
 *
 * Run: node scripts/test-gp-test-release.mjs
 */
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (process.env.SB_GP_RELEASE_TEST !== "1") {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /SECRET|TOKEN|KEY|DATABASE|POSTGRES|NEON|STRIPE|PASSWORD|COOKIE|AUTH/i.test(key)
    ) {
      delete env[key];
    }
  }
  env.SB_GP_RELEASE_TEST = "1";
  env.NODE_ENV = "test";
  env.SESSION_SECRET = "gp-test-release-session-secret";
  env.CRON_SECRET = "gp-test-release-cron-secret";
  env.DATABASE_URL = "postgresql://mock:mock@127.0.0.1:9/mock";
  env.PAYMENTS_ENABLED = "true";
  env.PROTECTED_PAYMENTS_ENABLED = "true";
  env.PROCUREMENT_ADVANCES_ENABLED = "true";
  env.LIVE_PAYMENTS_ENABLED = "true";
  env.GLOBAL_PAYOUTS_ENABLED = "true";
  env.GLOBAL_PAYOUTS_SANDBOX_ENABLED = "true";
  env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED = "false";
  env.GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST = "TH";
  env.GP_SANDBOX_APPROVED_BUYER_ID = `c${"a".repeat(24)}`;
  env.GP_SANDBOX_APPROVED_SOURCER_ID = `c${"b".repeat(24)}`;
  env.GP_SANDBOX_CURRENCY = "gbp";
  env.GP_SANDBOX_MAX_AMOUNT_MINOR = "5000";
  env.STRIPE_SECRET_KEY_TEST = "sk_test_mock_gp_release";
  env.STRIPE_SECRET_KEY_LIVE = "sk_live_mock_gp_release";
  env.STRIPE_GP_RESTRICTED_KEY_TEST = "rk_test_mock_gp_release";
  env.STRIPE_GP_RESTRICTED_KEY_LIVE = "rk_live_mock_gp_release";
  env.STRIPE_GP_FINANCIAL_ACCOUNT_ID_TEST = "fa_test_sandbox_gb";
  env.STRIPE_GP_FINANCIAL_ACCOUNT_ID_LIVE = "fa_live_mock_gb";
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      pathToFileURL(path.join(here, "gp-sandbox-ticket-loader.mjs")).href,
      fileURLToPath(import.meta.url),
    ],
    { cwd: root, env, stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const BUYER = process.env.GP_SANDBOX_APPROVED_BUYER_ID;
const SOURCER = process.env.GP_SANDBOX_APPROVED_SOURCER_ID;
const OTHER_A = `c${"d".repeat(24)}`;
const OTHER_B = `c${"e".repeat(24)}`;
const FA_TEST = process.env.STRIPE_GP_FINANCIAL_ACCOUNT_ID_TEST;
const RECIPIENT = "acct_test_th_recipient";
const METHOD = "pm_test_th_method";
const NORMAL_FEES = [
  { type: "payout_fee", amount: { value: 20, currency: "gbp" } },
  { type: "cross_border_fee", amount: { value: 30, currency: "gbp" } },
  { type: "fx_fee", amount: { value: 15, currency: "gbp" } },
];

const controls = {
    balance: 100000,
    faCountry: "GB",
    feeMode: "normal",
    quoteThrow: false,
    paymentThrow: false,
    paymentStatus: "processing",
    faStatus: 200,
    faErrorCode: "account_invalid",
    faId: "",
    faLivemode: false,
    available: "gbp",
  };

const httpLog = [];
globalThis.__SB_HTTP_LOG = httpLog;
const idempotentResponses = new Map();
let seq = 0;
let quoteSeq = 0;
let paySeq = 0;

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function cuid() {
  seq += 1;
  return `c${seq.toString(36).padStart(24, "0")}`;
}

function userRow(id, username) {
  return {
    id,
    email: `${username}@example.test`,
    emailVerified: new Date(),
    identityVerified: true,
    identityVerificationStatus: "VERIFIED",
    isAdmin: false,
    role: "USER",
    mustChangePassword: false,
    passwordHash: "hashed",
    name: username,
    username,
    slug: username,
    photo: "",
    cover: "",
    bio: "",
    publicDisplayMessage: "",
    city: "",
    country: username === "luckyday" ? "TH" : "GB",
    memberType: "MEMBER",
    intent: "",
    specialties: "",
    onboardingComplete: true,
    isDiscoverable: true,
    isTestAccount: false,
    isDemo: false,
    notificationSoundsEnabled: true,
    notificationVolume: 1,
    deletedAt: null,
    createdAt: new Date(),
    trustLevel: 3,
  };
}

const users = new Map([
  [BUYER, userRow(BUYER, "futureman")],
  [SOURCER, userRow(SOURCER, "luckyday")],
  [OTHER_A, userRow(OTHER_A, "buyerordinary")],
  [OTHER_B, userRow(OTHER_B, "sourcerordinary")],
]);

const tables = {
  user: [...users.values()],
  protectedTransaction: [],
  outboundPaymentAttempt: [],
  transferAttempt: [],
  financialAuditEvent: [],
  disputeCase: [],
  globalPayoutRecipient: [
    {
      id: "gpr_test",
      stripeRecipientId: RECIPIENT,
      stripeMode: "TEST",
      defaultCurrency: "thb",
    },
  ],
  stripeConnectAccount: [
    {
      id: "sca_test",
      userId: OTHER_B,
      stripeMode: "TEST",
      stripeAccountId: "acct_test_connect_ordinary",
      chargesEnabled: true,
      payoutsEnabled: true,
    },
  ],
  ledgerEntry: [],
  paymentTicket: [],
  session: [],
  notification: [],
  conversation: [],
  conversationParticipant: [],
};

function isOperator(value) {
  if (!value || typeof value !== "object" || value instanceof Date || Array.isArray(value)) {
    return false;
  }
  return ["in", "notIn", "not", "lte", "gte"].some((key) => key in value);
}

function matches(row, where) {
  if (!where) return true;
  for (const [key, expected] of Object.entries(where)) {
    if (isOperator(expected)) {
      const actual = row[key];
      if ("in" in expected && !expected.in.includes(actual)) return false;
      if ("notIn" in expected && expected.notIn.includes(actual)) return false;
      if ("not" in expected && actual === expected.not) return false;
      if ("lte" in expected) {
        if (actual == null) return false;
        const left = actual instanceof Date ? actual.getTime() : new Date(actual).getTime();
        const right =
          expected.lte instanceof Date ? expected.lte.getTime() : new Date(expected.lte).getTime();
        if (!(left <= right)) return false;
      }
      if ("gte" in expected) {
        if (actual == null) return false;
        const left = actual instanceof Date ? actual.getTime() : new Date(actual).getTime();
        const right =
          expected.gte instanceof Date ? expected.gte.getTime() : new Date(expected.gte).getTime();
        if (!(left >= right)) return false;
      }
      continue;
    }
    if (expected && typeof expected === "object" && !(expected instanceof Date) && !Array.isArray(expected)) {
      for (const [inner, value] of Object.entries(expected)) {
        if (row[inner] !== value) return false;
      }
      continue;
    }
    if (row[key] !== expected) return false;
  }
  return true;
}

function applyData(row, data) {
  for (const [key, value] of Object.entries(data || {})) {
    if (value && typeof value === "object" && !(value instanceof Date) && "increment" in value) {
      row[key] = (row[key] || 0) + value.increment;
    } else {
      row[key] = value;
    }
  }
  row.updatedAt = new Date();
  return row;
}

function project(row, select) {
  if (!select) return row;
  const out = {};
  for (const key of Object.keys(select)) {
    if (select[key]) out[key] = row[key];
  }
  return out;
}

function withInclude(row, include) {
  if (!include || !row) return row;
  const copy = { ...row };
  if (include.buyer) copy.buyer = users.get(row.buyerId) || null;
  if (include.seller) copy.seller = users.get(row.sellerId) || null;
  if (include.user) copy.user = users.get(row.userId) || null;
  if (include.paymentTicket) {
    copy.paymentTicket =
      tables.paymentTicket.find((ticket) => ticket.protectedTransactionId === row.id) || null;
  }
  if (include.protectedTransaction) {
    copy.protectedTransaction =
      tables.protectedTransaction.find((txn) => txn.id === row.protectedTransactionId) || null;
  }
  return copy;
}

function sortRows(rows, orderBy) {
  if (!orderBy) return rows;
  const [key, dir] = Object.entries(orderBy)[0];
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[key] instanceof Date ? a[key].getTime() : a[key] ?? 0;
    const bv = b[key] instanceof Date ? b[key].getTime() : b[key] ?? 0;
    if (av < bv) return -1 * sign;
    if (av > bv) return 1 * sign;
    return 0;
  });
}

function rowsOf(model) {
  if (!tables[model]) {
    tables[model] = [];
  }
  return tables[model];
}

function uniqueHit(model, data) {
  if (!data?.idempotencyKey) return;
  const clash = rowsOf(model).some((row) => row.idempotencyKey === data.idempotencyKey);
  if (clash) {
    throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
  }
}

function copyRow(row) {
  if (!row || typeof row !== "object") return row;
  return { ...row };
}

function dispatch(model, method, args) {
  if (model === "platformPaymentConfig" && (method === "upsert" || method === "findUnique")) {
    return {
      id: "default",
      protectionFeeBps: 700,
      protectionFeeFloorMinor: 0,
      directServiceFeeBps: 700,
      directServiceFeeFloorMinor: 0,
      sellerServiceFeeBps: 0,
      inspectionHours: 12,
      procurementMinTrustLevel: 2,
      procurementAdvancesGloballyOn: false,
      allowedCurrenciesJson: "[]",
      stripePlatformCountry: "GB",
    };
  }
  const rows = rowsOf(model);
  if (method === "findUnique" || method === "findUniqueOrThrow" || method === "findFirst") {
    const found = rows.find((row) => matches(row, args?.where));
    if (!found && method === "findUniqueOrThrow") {
      throw Object.assign(new Error(`${model} not found`), { code: "P2025" });
    }
    if (!found) return null;
    return copyRow(project(withInclude(found, args?.include), args?.select));
  }
  if (method === "findMany") {
    let found = rows.filter((row) => matches(row, args?.where));
    found = sortRows(found, args?.orderBy);
    if (args?.take) found = found.slice(0, args.take);
    return found.map((row) => copyRow(project(withInclude(row, args?.include), args?.select)));
  }
  if (method === "create") {
    uniqueHit(model, args?.data);
    const row = {
      id: args?.data?.id || `${model}_${rows.length + 1}`,
      failureCode: "",
      failureMessage: "",
      fxRateSnapshot: "",
      stripeOutboundPaymentId: "",
      stripeTransferId: "",
      reconciliationNote: "",
      initiatedAt: null,
      attemptCount: 0,
      lastAttemptAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(args?.data || {}),
    };
    rows.push(row);
    return copyRow(row);
  }
  if (method === "update") {
    const found = rows.find((row) => matches(row, args?.where));
    if (!found) throw Object.assign(new Error(`${model} not found`), { code: "P2025" });
    applyData(found, args?.data);
    return copyRow(project(found, args?.select));
  }
  if (method === "updateMany") {
    const found = rows.filter((row) => matches(row, args?.where));
    for (const row of found) applyData(row, args?.data);
    return { count: found.length };
  }
  if (method === "deleteMany") {
    const keep = [];
    let count = 0;
    for (const row of rows) {
      if (matches(row, args?.where)) count += 1;
      else keep.push(row);
    }
    tables[model] = keep;
    return { count };
  }
  if (method === "count") return rows.filter((row) => matches(row, args?.where)).length;
  throw new Error(`${model}.${method} is not mocked`);
}

globalThis.__SB_PRISMA = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === "$transaction") {
        return async (arg) =>
          typeof arg === "function" ? arg(globalThis.__SB_PRISMA) : Promise.all(arg);
      }
      if (prop === "$executeRaw" || prop === "$queryRaw") return async () => [];
      if (prop === "then") return undefined;
      if (typeof prop !== "string" || prop.startsWith("$")) return undefined;
      return new Proxy(
        {},
        {
          get(_model, method) {
            if (typeof method !== "string") return undefined;
            return (args) => Promise.resolve(dispatch(prop, method, args));
          },
        },
      );
    },
  },
);

function signCookie(raw) {
  const sig = createHmac("sha256", process.env.SESSION_SECRET).update(raw).digest("hex");
  return `${raw}.${sig}`;
}

function hashToken(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

function installSession(userId, raw) {
  tables.session.push({
    id: `session_${userId.slice(0, 8)}`,
    userId,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return signCookie(raw);
}

const buyerCookie = installSession(BUYER, "buyer-release-token");
const sourcerCookie = installSession(SOURCER, "sourcer-release-token");
const ordinaryCookie = installSession(OTHER_A, "ordinary-buyer-token");
globalThis.__SB_COOKIE_VALUES = { sb_session: buyerCookie };
globalThis.__SB_COOKIE_JAR = {
  get(name) {
    const value = globalThis.__SB_COOKIE_VALUES[name];
    return value ? { name, value } : undefined;
  },
  set() {},
  delete(name) {
    delete globalThis.__SB_COOKIE_VALUES[name];
  },
  has(name) {
    return Boolean(globalThis.__SB_COOKIE_VALUES[name]);
  },
  getAll() {
    return Object.entries(globalThis.__SB_COOKIE_VALUES).map(([name, value]) => ({ name, value }));
  },
};

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name) || headers.get(name.toLowerCase());
  return headers[name] || headers[name.toLowerCase()] || null;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "request-id": "req_mock" },
  });
}

function quoteBody(amount) {
  quoteSeq += 1;
  const quoted = controls.feeMode === "mismatch" ? amount + 1 : amount;
  const fees =
    controls.feeMode === "fractional"
      ? [{ type: "fx_fee", amount: { value: 1.5, currency: "gbp" } }]
      : NORMAL_FEES;
  return {
    id: `obpq_test_${quoteSeq}`,
    livemode: false,
    amount: { value: quoted, currency: "gbp" },
    from: {
      financial_account: FA_TEST,
      currency: "gbp",
      debited: { value: quoted, currency: "gbp" },
    },
    to: {
      recipient: RECIPIENT,
      payout_method: METHOD,
      currency: "thb",
      credited: { value: Math.max(1, amount * 40), currency: "thb" },
    },
    fx_quote: {
      lock_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      lock_status: "active",
      to_currency: "thb",
      rates: { gbp: { exchange_rate: "40" } },
    },
    estimated_fees: fees,
  };
}

globalThis.fetch = async (url, init) => {
  const href = String(url);
  const method = (init?.method || "GET").toUpperCase();
  const rawBody = typeof init?.body === "string" ? init.body : "";
  let body = null;
  if (rawBody.startsWith("{")) body = JSON.parse(rawBody);
  const parsed = new URL(href);
  const idempotencyKey = headerValue(init?.headers, "Idempotency-Key");
  httpLog.push({
    method,
    path: parsed.pathname,
    body,
    rawBody,
    idempotencyKey,
  });
  if (method === "POST" && idempotencyKey && idempotentResponses.has(idempotencyKey)) {
    return idempotentResponses.get(idempotencyKey).clone();
  }
  const response = await mockStripeResponse(parsed, method, body);
  if (method === "POST" && idempotencyKey) idempotentResponses.set(idempotencyKey, response.clone());
  return response;
};

async function mockStripeResponse(parsed, method, body) {
  if (parsed.pathname.includes("outbound_payment_quotes")) {
    if (controls.quoteThrow) throw new Error("socket hang up");
    const amount = body?.amount?.value;
    return jsonResponse(quoteBody(amount));
  }
  if (parsed.pathname.includes("outbound_payments") && method === "POST") {
    if (controls.paymentThrow) throw new Error("socket hang up");
    paySeq += 1;
    return jsonResponse({
      id: `obp_test_${paySeq}`,
      status: controls.paymentStatus,
    });
  }
  if (parsed.pathname.includes("outbound_payments") && method === "GET") {
    return jsonResponse({ data: [] });
  }
  if (parsed.pathname.includes("financial_accounts")) {
    if (controls.faStatus !== 200) {
      return jsonResponse(
        {
          error: {
            type: "invalid_request_error",
            code: controls.faErrorCode,
            message: "sk_test_should_not_leak",
          },
        },
        controls.faStatus,
      );
    }
    const currency = "gbp";
    let available;
    if (controls.available === "usd-only") {
      available = { usd: { value: controls.balance, currency: "usd" } };
    } else if (controls.available === "mismatch") {
      available = { gbp: { value: controls.balance, currency: "usd" } };
    } else if (controls.available === "fraction") {
      available = { gbp: { value: 10.5, currency: "gbp" } };
    } else if (controls.available === "negative") {
      available = { gbp: { value: -1, currency: "gbp" } };
    } else {
      available = { [currency]: { value: controls.balance, currency } };
    }
    const id = controls.faId || parsed.pathname.split("/").pop();
    return jsonResponse({
      id,
      object: "v2.money_management.financial_account",
      livemode: controls.faLivemode === true || String(id || "").includes("fa_live"),
      country: controls.faCountry,
      status: "open",
      type: "storage",
      balance: { available },
    });
  }
  if (parsed.pathname.includes("payout_methods")) {
    return jsonResponse({
      id: METHOD,
      bank_account: { country: "TH", supported_currencies: ["thb"] },
    });
  }
  if (parsed.pathname.includes("/v1/charges/")) {
    return jsonResponse({
      id: "ch_test_connect",
      object: "charge",
      currency: "gbp",
      amount: 1070,
      balance_transaction: { currency: "gbp", amount: 1070 },
    });
  }
  if (parsed.pathname.includes("/v1/transfers")) {
    return jsonResponse({ id: "tr_test_connect", object: "transfer" });
  }
  if (parsed.pathname.includes("/v1/payment_intents")) {
    return jsonResponse({ id: "pi_test", object: "payment_intent", latest_charge: "ch_test_connect" });
  }
  return jsonResponse({ error: { message: "unexpected stripe path" } }, 404);
};

function resetControls() {
  controls.balance = 100000;
  controls.faCountry = "GB";
  controls.feeMode = "normal";
  controls.quoteThrow = false;
  controls.paymentThrow = false;
  controls.paymentStatus = "processing";
  controls.faStatus = 200;
  controls.faErrorCode = "account_invalid";
  controls.faId = "";
  controls.faLivemode = false;
  controls.available = "gbp";
}

function gpTxn(overrides = {}) {
  const id = overrides.id || cuid();
  const row = {
    id,
    buyerId: BUYER,
    sellerId: SOURCER,
    status: "DELIVERED",
    paymentOption: "PROTECTED",
    origin: "CHAT_TICKET",
    stripeMode: "TEST",
    payoutRail: "STRIPE_GLOBAL_PAYOUTS",
    currency: "gbp",
    itemCostMinor: 2000,
    shippingMinor: 500,
    sellerServiceFeeMinor: 1000,
    protectionFeeMinor: 245,
    totalChargeMinor: 3745,
    platformFeeIncludedInPrice: false,
    procurementAdvanceAgreed: false,
    procurementAdvanceMinor: 0,
    procurementTransferredMinor: 0,
    finalTransferredMinor: 0,
    refundedMinor: 0,
    shippedAt: new Date(),
    trackingNumber: "TRACK",
    trackingCarrier: "",
    shipmentPhotoUrl: "",
    deliveredAt: new Date(),
    inspectionEndsAt: null,
    releasedAt: null,
    sellerGpRecipientId: RECIPIENT,
    sellerGpPayoutMethodId: METHOD,
    sellerConnectAccountId: "",
    stripeChargeId: "",
    stripePaymentIntentId: "",
    termsHash: "terms35",
    listingId: null,
    conversationId: null,
    title: "Sandbox item",
    sourcingRequestId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    id,
  };
  tables.protectedTransaction.push(row);
  return row;
}

function park(id) {
  const row = tables.protectedTransaction.find((txn) => txn.id === id);
  if (row) row.status = "DISPUTED";
}

function posts(pathPart, since) {
  return httpLog.slice(since).filter((call) => call.method === "POST" && call.path.includes(pathPart));
}

function attemptFor(txnId) {
  return tables.outboundPaymentAttempt.find((row) => row.protectedTxnId === txnId);
}

const { NextRequest } = await import("./gp-sandbox-next-server-mock.mjs");
const confirmReceipt = await import("../src/app/api/payments/confirm-receipt/route.ts");
const releaseProcurement = await import("../src/app/api/payments/release-procurement/route.ts");
const inspectionCron = await import("../src/app/api/cron/payments-release/route.ts");
const { gpQuoteConfirmationRequired } = await import(
  "../src/lib/payments/payout-rail/quote-confirmation.ts"
);
const { evaluateQuoteConfirmation } = await import("../src/lib/payments/payout-rail/live-pilot.ts");

async function postJson(handler, url, body, headers = {}) {
  const req = new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const res = await handler.POST(req);
  const json = await res.json();
  return { status: res.status, json };
}

function useBuyer() {
  globalThis.__SB_COOKIE_VALUES.sb_session = buyerCookie;
}
function useSourcer() {
  globalThis.__SB_COOKIE_VALUES.sb_session = sourcerCookie;
}

async function releaseNow(txnId) {
  useBuyer();
  return postJson(confirmReceipt, "http://localhost/api/payments/confirm-receipt", {
    protectedTxnId: txnId,
    decision: "RELEASE_NOW",
  });
}

assert(gpQuoteConfirmationRequired("TEST", "STRIPE_GLOBAL_PAYOUTS") === false, "TEST GP skips quote confirmation");
assert(gpQuoteConfirmationRequired("LIVE", "STRIPE_GLOBAL_PAYOUTS") === true, "LIVE GP keeps quote confirmation");
assert(gpQuoteConfirmationRequired("", "STRIPE_GLOBAL_PAYOUTS") === true, "missing mode keeps confirmation");
assert(gpQuoteConfirmationRequired("TEST", "STRIPE_CONNECT") === false, "Connect has no quote confirmation");
const testControl = gpQuoteConfirmationRequired("TEST", "STRIPE_GLOBAL_PAYOUTS");
const liveControl = gpQuoteConfirmationRequired("LIVE", "STRIPE_GLOBAL_PAYOUTS");
assert(testControl === false, "mocked TEST ticket keeps the existing release button");
assert(liveControl === true, "mocked LIVE ticket still requires quote review");
const cardSrc = fs.readFileSync(path.join(root, "src/components/messaging/PaymentTicketCard.tsx"), "utf8");
const purchasesSrc = fs.readFileSync(path.join(root, "src/app/profile/purchases/page.tsx"), "utf8");
assert(cardSrc.includes('submitReceiptDecision("RELEASE_NOW")'), "conversation release still uses the existing button");
assert(cardSrc.includes("quoteConfirmationRequired && !gpQuoteConfirmed"), "LIVE inspection release stays behind quote review");
assert(purchasesSrc.includes("quoteConfirmationRequired &&"), "Purchases release stays behind quote review for LIVE");
assert(!cardSrc.includes("confirmedByUserId"), "conversation control does not fabricate confirmation");

const outboundSrc = fs.readFileSync(
  path.join(root, "src/lib/payments/payout-rail/outbound-payment.ts"),
  "utf8",
);
const testBranch = outboundSrc.slice(
  outboundSrc.indexOf('if (opts.txnMode === "TEST")'),
  outboundSrc.indexOf('if (opts.txnMode !== "LIVE")'),
);
assert(!testBranch.includes("evaluateQuoteConfirmation"), "TEST release must not require quote confirmation");
assert(!testBranch.includes("confirmedByUserId"), "TEST release must not fabricate confirmation");
assert(
  outboundSrc.includes("evaluateQuoteConfirmation"),
  "LIVE release still evaluates quote confirmation",
);
const releaseSrc = fs.readFileSync(path.join(root, "src/lib/payments/release.ts"), "utf8");
assert(releaseSrc.includes("inspection_not_authorized"), "TEST inspection requires recorded authorization");
for (const file of [
  "src/components/messaging/PaymentTicketCard.tsx",
  "src/app/profile/purchases/page.tsx",
]) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  assert(text.includes("gpQuoteConfirmationRequired"), `${file} uses the TEST confirmation gate`);
  assert(text.includes("GpQuoteReview"), `${file} still has LIVE quote review`);
}

const liveConfirm = evaluateQuoteConfirmation({
  stored: null,
  actorUserId: BUYER,
  transactionId: "c" + "f".repeat(24),
  mode: "LIVE",
  recipientId: RECIPIENT,
  payoutMethodId: METHOD,
  sourceAmountMinor: 3500,
  sourceCurrency: "gbp",
  destinationCurrency: "thb",
  termsHash: "terms35",
  nowMs: Date.now(),
});
assert(liveConfirm.ok === false && liveConfirm.code === "GP_QUOTE_REVIEW_REQUIRED", "LIVE confirmation stays closed");

{
  const txn = gpTxn();
  const since = httpLog.length;
  const res = await releaseNow(txn.id);
  assert(res.status === 200, `manual release status ${res.status} ${res.json.error || ""}`);
  assert(res.json.pendingProvider === true, "manual release waits for provider confirmation");
  assert(res.json.transaction.totalChargeMinor === 3745, "buyer total stays 3745");
  assert(res.json.transaction.platformFeeMinor === 245, "Source Bridge fee stays 245");
  assert(res.json.transaction.sellerEntitledMinor === 3500, "seller entitlement stays 3500");
  assert(res.json.transaction.finalResidualMinor === 3500, "final residual stays 3500");
  const quotes = posts("outbound_payment_quotes", since);
  const payments = posts("outbound_payments", since);
  assert(quotes.length === 1, `expected one quote, saw ${quotes.length}`);
  assert(payments.length === 1, `expected one payment, saw ${payments.length}`);
  assert(quotes[0].body.amount.value === 3500, "quote principal is the seller entitlement");
  assert(quotes[0].body.amount.currency === "gbp", "quote currency is gbp");
  assert(payments[0].body.amount.value === 3500, "payment principal is the seller entitlement");
  assert(payments[0].body.amount.currency === "gbp", "payment currency is gbp");
  assert(payments[0].body.to.currency === "thb", "payment destination currency is thb");
  const attempt = attemptFor(txn.id);
  const snap = JSON.parse(attempt.fxRateSnapshot);
  assert(snap.quoteId.startsWith("obpq_"), "stored quote id");
  assert(payments[0].body.outbound_payment_quote === snap.quoteId, "payment attaches the stored quote");
  assert(snap.confirmedByUserId == null, "snapshot has no fabricated confirmer");
  assert(snap.feePayer === "Source Bridge", "provider fees are paid by Source Bridge");
  assert(attempt.providerFeeMinor === 20, "provider fee recorded separately");
  assert(attempt.crossBorderFeeMinor === 30, "cross-border fee recorded separately");
  assert(attempt.fxFeeMinor === 15, "fx fee recorded separately");
  assert(quotes[0].idempotencyKey === `${payments[0].idempotencyKey}_quote`, "quote and payment keys differ");
  assert(!quotes[0].idempotencyKey.includes("quote_quote"), "quote key is not doubled");
  const againSince = httpLog.length;
  const again = await releaseNow(txn.id);
  assert(again.status === 409, `repeat release status ${again.status}`);
  assert(posts("outbound_payments", againSince).length === 0, "repeat release created a payment");
  assert(posts("outbound_payment_quotes", againSince).length === 0, "repeat release created a quote");
  assert(attemptFor(txn.id).fxRateSnapshot === attempt.fxRateSnapshot, "repeat replaced the quote snapshot");
}

{
  const txn = gpTxn();
  const since = httpLog.length;
  const [first, second] = await Promise.all([releaseNow(txn.id), releaseNow(txn.id)]);
  const payments = posts("outbound_payments", since);
  assert(payments.length === 1, `concurrent release created ${payments.length} payments`);
  const paymentKeys = new Set(payments.map((call) => call.idempotencyKey));
  assert(paymentKeys.size === 1, `concurrent release used ${paymentKeys.size} payment keys`);
  const quoteCalls = posts("outbound_payment_quotes", since);
  const quoteKeys = new Set(quoteCalls.map((call) => call.idempotencyKey));
  assert(quoteKeys.size === 1, `concurrent release used ${quoteKeys.size} quote keys`);
  assert([...paymentKeys][0] !== [...quoteKeys][0], "concurrent quote and payment keys match");
  const statuses = [first.status, second.status].sort();
  assert(statuses.includes(200), `concurrent release did not succeed ${statuses.join(",")}`);
  const snap = attemptFor(txn.id).fxRateSnapshot;
  assert(JSON.parse(snap).quoteId === payments[0].body.outbound_payment_quote, "concurrent workers kept one stored quote");
  const held = snap;
  const third = await releaseNow(txn.id);
  assert(third.status === 409, `post-claim retry status ${third.status}`);
  assert(attemptFor(txn.id).fxRateSnapshot === held, "a later retry replaced the stored quote");
}

{
  const txn = gpTxn({ status: "READY_TO_RELEASE" });
  tables.outboundPaymentAttempt.push({
    id: "attempt_shared_claim",
    protectedTxnId: txn.id,
    kind: "FINAL",
    amountMinor: 3500,
    currency: "gbp",
    stripeMode: "TEST",
    idempotencyKey: `final_gp_${txn.id}_${txn.termsHash}`,
    status: "PENDING",
    stripeRecipientId: RECIPIENT,
    stripePayoutMethodId: METHOD,
    stripeOutboundPaymentId: "",
    fxRateSnapshot: "",
    failureCode: "",
    failureMessage: "",
    initiatedAt: null,
    attemptCount: 0,
    reconciliationNote: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const since = httpLog.length;
  const [first, second] = await Promise.all([releaseNow(txn.id), releaseNow(txn.id)]);
  const payments = posts("outbound_payments", since);
  assert(payments.length === 1, `shared attempt created ${payments.length} payments`);
  const snap = attemptFor(txn.id).fxRateSnapshot;
  assert(JSON.parse(snap).quoteId === payments[0].body.outbound_payment_quote, "shared attempt kept the first quote");
  assert([first.status, second.status].includes(200), "shared attempt did not complete one release");
  assert([first.status, second.status].includes(409), "overlapping worker was not stopped by the claim");
}

{
  const txn = gpTxn();
  const expired = {
    v: 1,
    quoteId: "obpq_expired_snapshot",
    sourceAmountMinor: 3500,
    sourceCurrency: "gbp",
    destinationCurrency: "thb",
    destinationAmountMinor: 140000,
    expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    lockStatus: "active",
    providerFeeMinor: 20,
    crossBorderFeeMinor: 30,
    fxFeeMinor: 15,
    providerFeeCurrency: "gbp",
    crossBorderFeeCurrency: "gbp",
    fxFeeCurrency: "gbp",
    feePayer: "Source Bridge",
  };
  tables.outboundPaymentAttempt.push({
    id: "attempt_expired",
    protectedTxnId: txn.id,
    kind: "FINAL",
    amountMinor: 3500,
    currency: "gbp",
    stripeMode: "TEST",
    idempotencyKey: `final_gp_${txn.id}_${txn.termsHash}`,
    status: "PENDING",
    stripeRecipientId: RECIPIENT,
    stripePayoutMethodId: METHOD,
    stripeOutboundPaymentId: "",
    fxRateSnapshot: JSON.stringify(expired),
    failureCode: "",
    failureMessage: "",
    initiatedAt: null,
    attemptCount: 0,
    reconciliationNote: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const since = httpLog.length;
  const res = await releaseNow(txn.id);
  assert(res.status === 409, `expired quote status ${res.status} ${res.json.error || ""}`);
  assert(posts("outbound_payments", since).length === 0, "expired quote submitted a payment");
  assert(posts("outbound_payment_quotes", since).length === 0, "expired quote was replaced");
  assert(
    attemptFor(txn.id).fxRateSnapshot.includes("obpq_expired_snapshot"),
    "expired snapshot was rewritten",
  );
  park(txn.id);
}

{
  const txn = gpTxn();
  controls.feeMode = "mismatch";
  const since = httpLog.length;
  const res = await releaseNow(txn.id);
  assert(res.status >= 400, `invalid quote status ${res.status}`);
  assert(posts("outbound_payments", since).length === 0, "invalid quote submitted a payment");
  const snap = attemptFor(txn.id)?.fxRateSnapshot || "";
  assert(!snap.includes("obpq_"), "invalid quote was stored");
  park(txn.id);
  resetControls();
}

{
  const txn = gpTxn();
  controls.faCountry = "";
  const since = httpLog.length;
  const res = await releaseNow(txn.id);
  assert(res.status === 409, `unresolved country status ${res.status} ${res.json.error || ""}`);
  assert(posts("outbound_payment_quotes", since).length === 0, "unresolved country quoted");
  assert(posts("outbound_payments", since).length === 0, "unresolved country submitted a payment");
  assert(attemptFor(txn.id)?.failureCode === "GP_QUOTE_COUNTRY_UNRESOLVED", "country failure code");
  park(txn.id);
  resetControls();
}

{
  const txn = gpTxn();
  controls.feeMode = "fractional";
  const since = httpLog.length;
  const res = await releaseNow(txn.id);
  assert(res.status >= 400, `fractional fee status ${res.status}`);
  assert(posts("outbound_payments", since).length === 0, "unrepresentable fee submitted a payment");
  assert(attemptFor(txn.id)?.failureCode === "GP_QUOTE_FEE_UNREPRESENTABLE", "fee failure code");
  park(txn.id);
  resetControls();
}

{
  const txn = gpTxn();
  controls.balance = 3510;
  const since = httpLog.length;
  const res = await releaseNow(txn.id);
  assert(res.status >= 400, `short funding status ${res.status} ${res.json.error || ""}`);
  assert(posts("outbound_payment_quotes", since).length === 1, "funding check quoted before the fee-inclusive gate");
  assert(posts("outbound_payments", since).length === 0, "short funding submitted a payment");
  assert(attemptFor(txn.id)?.failureCode === "GP_PILOT_FUNDING_SHORT", "funding failure code");
  park(txn.id);
  resetControls();
}

{
  const txn = gpTxn();
  controls.faStatus = 403;
  const since = httpLog.length;
  const res = await releaseNow(txn.id);
  assert(res.status === 409, `unreadable balance status ${res.status}`);
  assert(posts("outbound_payment_quotes", since).length === 0, "failed balance read quoted");
  assert(posts("outbound_payments", since).length === 0, "failed balance read submitted a payment");
  const attempt = attemptFor(txn.id);
  assert(attempt?.failureCode === "GP_FA_BALANCE_HTTP", "http failure code");
  assert(
    String(attempt?.failureMessage || "").includes("403") &&
      String(attempt?.failureMessage || "").includes("account_invalid"),
    "http failure keeps status and code",
  );
  assert(!String(attempt?.failureMessage || "").includes("sk_test_"), "http failure leaked provider text");
  park(txn.id);
  resetControls();
}

{
  const txn = gpTxn();
  controls.available = "usd-only";
  const since = httpLog.length;
  const res = await releaseNow(txn.id);
  assert(res.status === 409, `other currency status ${res.status}`);
  assert(posts("outbound_payment_quotes", since).length === 0, "other currency quoted");
  assert(attemptFor(txn.id)?.failureCode === "GP_FA_BALANCE_CURRENCY", "missing currency code");
  park(txn.id);
  resetControls();
}

{
  const txn = gpTxn();
  controls.available = "mismatch";
  const res = await releaseNow(txn.id);
  assert(res.status === 409, `mismatched currency status ${res.status}`);
  assert(attemptFor(txn.id)?.failureCode === "GP_FA_BALANCE_CURRENCY", "mismatched currency code");
  park(txn.id);
  resetControls();
}

{
  const txn = gpTxn();
  controls.available = "fraction";
  const res = await releaseNow(txn.id);
  assert(res.status === 409, `fractional balance status ${res.status}`);
  assert(attemptFor(txn.id)?.failureCode === "GP_FA_BALANCE_AMOUNT", "fractional amount code");
  park(txn.id);
  resetControls();
}

{
  const txn = gpTxn();
  controls.available = "negative";
  const res = await releaseNow(txn.id);
  assert(res.status === 409, `negative balance status ${res.status}`);
  assert(attemptFor(txn.id)?.failureCode === "GP_FA_BALANCE_AMOUNT", "negative amount code");
  park(txn.id);
  resetControls();
}

{
  const txn = gpTxn();
  controls.faLivemode = true;
  const res = await releaseNow(txn.id);
  assert(res.status === 409, `mode mismatch status ${res.status}`);
  assert(attemptFor(txn.id)?.failureCode === "GP_FA_MODE_MISMATCH", "mode mismatch code");
  park(txn.id);
  resetControls();
}

{
  const txn = gpTxn();
  controls.faId = "fa_other_account";
  const res = await releaseNow(txn.id);
  assert(res.status === 409, `account mismatch status ${res.status}`);
  assert(attemptFor(txn.id)?.failureCode === "GP_FA_ACCOUNT_MISMATCH", "account mismatch code");
  park(txn.id);
  resetControls();
}

{
  const txn = gpTxn();
  controls.quoteThrow = true;
  const since = httpLog.length;
  const first = await releaseNow(txn.id);
  assert(first.status === 409, `uncertain quote status ${first.status} ${first.json.error || ""}`);
  assert(posts("outbound_payments", since).length === 0, "uncertain quote submitted a payment");
  assert(attemptFor(txn.id)?.failureCode === "GP_PAYMENT_OUTCOME_UNCERTAIN", "uncertain failure code");
  controls.quoteThrow = false;
  const secondSince = httpLog.length;
  const second = await releaseNow(txn.id);
  assert(second.status === 409, `uncertain retry status ${second.status}`);
  assert(posts("outbound_payments", secondSince).length === 0, "uncertain retry submitted a payment");
  assert(posts("outbound_payment_quotes", secondSince).length === 0, "uncertain retry replaced the quote");
  park(txn.id);
  resetControls();
}

{
  const txn = gpTxn();
  controls.paymentThrow = true;
  const since = httpLog.length;
  const first = await releaseNow(txn.id);
  assert(first.status === 409, `ambiguous payment status ${first.status} ${first.json.error || ""}`);
  const firstQuote = posts("outbound_payment_quotes", since);
  const firstPayment = posts("outbound_payments", since);
  assert(firstQuote.length === 1, "ambiguous payment still quoted once");
  assert(firstPayment.length === 1, "ambiguous payment attempted one submission");
  const attempt = attemptFor(txn.id);
  assert(attempt.failureCode === "GP_PAYMENT_OUTCOME_UNCERTAIN", "ambiguous result is preserved");
  assert(attempt.initiatedAt, "payment claim remains after the ambiguous result");
  const heldSnapshot = attempt.fxRateSnapshot;
  const heldKey = firstPayment[0].idempotencyKey;
  controls.paymentThrow = false;
  const retrySince = httpLog.length;
  const retry = await releaseNow(txn.id);
  assert(retry.status === 409, `ambiguous retry status ${retry.status} ${retry.json.error || ""}`);
  assert(posts("outbound_payment_quotes", retrySince).length === 0, "ambiguous retry created a replacement quote");
  assert(posts("outbound_payments", retrySince).length === 0, "ambiguous retry created another payment");
  assert(attemptFor(txn.id).fxRateSnapshot === heldSnapshot, "ambiguous retry changed the stored quote");
  assert(
    !httpLog
      .slice(retrySince)
      .some((call) => call.idempotencyKey && call.idempotencyKey !== heldKey && call.idempotencyKey !== `${heldKey}_quote`),
    "ambiguous retry minted another payment key",
  );
  park(txn.id);
  resetControls();
}

{
  const unauthorized = gpTxn({ status: "READY_TO_RELEASE" });
  const buyerAuthorized = gpTxn({ status: "READY_TO_RELEASE" });
  const inspectionAuthorized = gpTxn({ status: "READY_TO_RELEASE" });
  tables.financialAuditEvent.push(
    {
      id: "audit_buyer_release",
      protectedTxnId: buyerAuthorized.id,
      actorUserId: BUYER,
      action: "BUYER_RELEASE_NOW",
      reason: "",
      metaJson: "{}",
    },
    {
      id: "audit_inspection_release",
      protectedTxnId: inspectionAuthorized.id,
      actorUserId: BUYER,
      action: "START_INSPECTION",
      reason: "",
      metaJson: "{}",
    },
  );
  const since = httpLog.length;
  delete globalThis.__SB_COOKIE_VALUES.sb_session;
  const cron = await postJson(
    inspectionCron,
    "http://localhost/api/cron/payments-release",
    null,
    { authorization: `Bearer ${process.env.CRON_SECRET}` },
  );
  useBuyer();
  assert(cron.status === 200, `ready retry cron status ${cron.status} ${cron.json.error || ""}`);
  const denied = cron.json.results.find((row) => row.id === unauthorized.id);
  const buyerResult = cron.json.results.find((row) => row.id === buyerAuthorized.id);
  const inspectionResult = cron.json.results.find((row) => row.id === inspectionAuthorized.id);
  assert(denied?.error === "release_not_authorized", `READY_TO_RELEASE alone was ${denied?.error || "released"}`);
  assert(
    tables.protectedTransaction.find((row) => row.id === unauthorized.id).status === "READY_TO_RELEASE",
    "unauthorized ready retry changed status",
  );
  assert(!attemptFor(unauthorized.id)?.stripeOutboundPaymentId, "unauthorized ready retry created a payment");
  assert(buyerResult?.ok === true, `buyer release retry failed ${buyerResult?.error || "missing"}`);
  assert(inspectionResult?.ok === true, `inspection release retry failed ${inspectionResult?.error || "missing"}`);
  const payments = posts("outbound_payments", since);
  assert(payments.length === 2, `authorized ready retries created ${payments.length} payments`);
  assert(payments.every((call) => call.body.amount.value === 3500), "authorized retries pay the stored entitlement");
}

{
  const txn = gpTxn();
  useSourcer();
  const since = httpLog.length;
  const res = await postJson(confirmReceipt, "http://localhost/api/payments/confirm-receipt", {
    protectedTxnId: txn.id,
    decision: "RELEASE_NOW",
  });
  useBuyer();
  assert(res.status === 403, `sourcer release status ${res.status}`);
  assert((res.json.error || "").includes("Only the buyer"), "manual release ownership changed");
  assert(posts("outbound_payments", since).length === 0, "sourcer release submitted a payment");
  assert(tables.protectedTransaction.find((row) => row.id === txn.id).status === "DELIVERED", "sourcer moved status");
}

{
  const authorized = gpTxn();
  const unauthorized = gpTxn({
    status: "IN_INSPECTION",
    inspectionEndsAt: new Date(Date.now() - 60 * 1000),
  });
  useBuyer();
  const started = await postJson(confirmReceipt, "http://localhost/api/payments/confirm-receipt", {
    protectedTxnId: authorized.id,
    decision: "START_INSPECTION",
  });
  assert(started.status === 200, `start inspection status ${started.status} ${started.json.error || ""}`);
  const auth = tables.financialAuditEvent.find(
    (row) => row.protectedTxnId === authorized.id && row.action === "START_INSPECTION",
  );
  assert(auth?.actorUserId === BUYER, "inspection authorization is the buyer audit event");
  tables.protectedTransaction.find((row) => row.id === authorized.id).inspectionEndsAt = new Date(
    Date.now() - 60 * 1000,
  );
  const since = httpLog.length;
  delete globalThis.__SB_COOKIE_VALUES.sb_session;
  const cron = await postJson(
    inspectionCron,
    "http://localhost/api/cron/payments-release",
    null,
    { authorization: `Bearer ${process.env.CRON_SECRET}` },
  );
  useBuyer();
  assert(cron.status === 200, `inspection cron status ${cron.status} ${cron.json.error || ""}`);
  const authResult = cron.json.results.find((row) => row.id === authorized.id);
  const denied = cron.json.results.find((row) => row.id === unauthorized.id);
  assert(authResult?.ok === true, `inspection release failed ${authResult?.error || "missing"}`);
  assert(denied?.ok === false && denied.error === "inspection_not_authorized", "missing inspection auth was released");
  assert(
    tables.protectedTransaction.find((row) => row.id === unauthorized.id).status === "IN_INSPECTION",
    "unauthorized inspection changed status",
  );
  const payments = posts("outbound_payments", since);
  const quotes = posts("outbound_payment_quotes", since);
  assert(payments.length === 1 && quotes.length === 1, "inspection release quote/payment count");
  assert(payments[0].body.amount.value === 3500, "inspection pays the stored entitlement");
  const initiated = tables.financialAuditEvent.find(
    (row) => row.protectedTxnId === authorized.id && row.action === "GP_OUTBOUND_INITIATED_FINAL",
  );
  assert(initiated && initiated.actorUserId == null, "inspection release did not require a fresh buyer actor");
}

{
  const advance = gpTxn({
    status: "FUNDED",
    deliveredAt: null,
    shippedAt: null,
    procurementAdvanceAgreed: true,
    procurementAdvanceMinor: 2000,
  });
  const residual = gpTxn({
    procurementAdvanceAgreed: true,
    procurementAdvanceMinor: 2000,
    procurementTransferredMinor: 2000,
  });
  useBuyer();
  const since = httpLog.length;
  const proc = await postJson(releaseProcurement, "http://localhost/api/payments/release-procurement", {
    protectedTxnId: advance.id,
  });
  assert(proc.status === 200, `procurement status ${proc.status} ${proc.json.error || ""}`);
  const procPay = posts("outbound_payments", since);
  assert(procPay.length === 1, "procurement created one payment");
  assert(procPay[0].body.amount.value === 2000, "procurement pays item funds once");
  assert(procPay[0].body.amount.value !== 3500, "procurement did not pay the full entitlement");
  const finalSince = httpLog.length;
  const finalRes = await releaseNow(residual.id);
  assert(finalRes.status === 200, `residual release status ${finalRes.status} ${finalRes.json.error || ""}`);
  assert(finalRes.json.transaction.sellerEntitledMinor === 3500, "two-stage entitlement stays 3500");
  assert(finalRes.json.transaction.platformFeeMinor === 245, "two-stage fee stays 245");
  assert(finalRes.json.transaction.finalResidualMinor === 1500, "final release pays only the residual");
  const finalPay = posts("outbound_payments", finalSince);
  assert(finalPay.length === 1 && finalPay[0].body.amount.value === 1500, "final payment is the residual only");
}

{
  const txn = gpTxn({
    buyerId: OTHER_A,
    sellerId: OTHER_B,
    payoutRail: "STRIPE_CONNECT",
    sellerGpRecipientId: "",
    sellerGpPayoutMethodId: "",
    itemCostMinor: 1000,
    shippingMinor: 0,
    sellerServiceFeeMinor: 0,
    protectionFeeMinor: 70,
    totalChargeMinor: 1070,
    stripeChargeId: "ch_test_connect",
    termsHash: "connectterms",
  });
  const since = httpLog.length;
  globalThis.__SB_COOKIE_VALUES.sb_session = ordinaryCookie;
  const res = await postJson(confirmReceipt, "http://localhost/api/payments/confirm-receipt", {
    protectedTxnId: txn.id,
    decision: "RELEASE_NOW",
  });
  useBuyer();
  assert(res.status === 200, `connect release status ${res.status} ${res.json.error || ""}`);
  assert(posts("outbound_payment_quotes", since).length === 0, "connect release quoted a global payout");
  assert(posts("outbound_payments", since).length === 0, "connect release created an outbound payment");
  const transfers = httpLog.slice(since).filter((call) => call.path.includes("/v1/transfers"));
  assert(transfers.length === 1, "connect release created one transfer");
  assert(res.json.transaction.sellerEntitledMinor === 1000, "connect entitlement is the item amount");
  assert(res.json.transaction.platformFeeMinor === 70, "connect fee stays on the platform");
  assert(res.json.transaction.finalResidualMinor === 0, "connect residual is paid");
  assert(
    tables.protectedTransaction.find((row) => row.id === txn.id).finalTransferredMinor === 1000,
    "connect books the seller entitlement once",
  );
  const connectLedger = tables.ledgerEntry.filter((row) => row.protectedTxnId === txn.id);
  assert(connectLedger.length === 1, "connect release books one ledger row");
  assert(connectLedger[0].stripeMode === "LIVE", "connect ledger keeps the platform mode");
  assert(connectLedger[0].entryType === "FINAL_TRANSFER", "connect ledger remains a final transfer");
  assert(connectLedger[0].amountMinor === 1000, "connect ledger amount stays the entitlement");
}

{
  const txn = gpTxn({ stripeMode: "LIVE" });
  process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED = "true";
  const since = httpLog.length;
  const res = await releaseNow(txn.id);
  process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED = "false";
  assert(res.status === 409, `live release status ${res.status} ${res.json.error || ""}`);
  assert(
    (res.json.error || "").includes("Review and confirm the payout estimate"),
    "LIVE confirmation message changed",
  );
  assert(posts("outbound_payment_quotes", since).length === 0, "LIVE release created a quote");
  assert(posts("outbound_payments", since).length === 0, "LIVE release created a payment");
  const snap = attemptFor(txn.id)?.fxRateSnapshot || "";
  assert(!snap.includes("confirmedByUserId"), "LIVE path fabricated a confirmer");
  park(txn.id);
}

{
  const { getStripeMode } = await import("../src/lib/payments/flags.ts");
  const { markTxnFundedFromWebhook } = await import("../src/lib/payments/checkout.ts");
  const { finalizeOutboundSuccess } = await import(
    "../src/lib/payments/payout-rail/outbound-payment.ts"
  );
  assert(getStripeMode() === "LIVE", "platform mode is LIVE for this regression");

  const testFund = gpTxn({
    status: "AWAITING_PAYMENT",
    payoutRailLockedAt: new Date(),
    stripePaymentIntentId: "pi_test_gp_ledger",
  });
  const funded = await markTxnFundedFromWebhook({
    paymentIntentId: "pi_test_gp_ledger",
    chargeId: "ch_test_gp_ledger",
    amountMinor: 3745,
    currency: "gbp",
    eventId: "evt_test_gp_ledger",
  });
  assert(funded.handled === true, `TEST GP funding ${funded.reason || "failed"}`);
  const testCharge = tables.ledgerEntry.find(
    (row) => row.protectedTxnId === testFund.id && row.entryType === "CHARGE",
  );
  assert(testCharge?.stripeMode === "TEST", "TEST GP charge ledger uses the transaction mode");
  assert(testCharge.amountMinor === 3745, "TEST GP charge amount stays 3745");
  assert(testCharge.stripeObjectId === "pi_test_gp_ledger", "TEST GP charge keeps the payment reference");

  const connectFund = gpTxn({
    status: "AWAITING_PAYMENT",
    payoutRail: "STRIPE_CONNECT",
    payoutRailLockedAt: new Date(),
    sellerGpRecipientId: "",
    sellerGpPayoutMethodId: "",
    stripePaymentIntentId: "pi_test_connect_ledger",
    buyerId: OTHER_A,
    sellerId: OTHER_B,
  });
  const connectFunded = await markTxnFundedFromWebhook({
    paymentIntentId: "pi_test_connect_ledger",
    chargeId: "ch_test_connect_ledger",
    amountMinor: 3745,
    currency: "gbp",
    eventId: "evt_test_connect_ledger",
  });
  assert(connectFunded.handled === true, `connect funding ${connectFunded.reason || "failed"}`);
  const connectCharge = tables.ledgerEntry.find(
    (row) => row.protectedTxnId === connectFund.id && row.entryType === "CHARGE",
  );
  assert(connectCharge?.stripeMode === "LIVE", "connect charge ledger keeps the platform mode");

  controls.paymentStatus = "posted";
  const posted = gpTxn({ status: "READY_TO_RELEASE" });
  const postedRes = await releaseNow(posted.id);
  controls.paymentStatus = "processing";
  assert(postedRes.status === 200, `posted TEST release ${postedRes.status} ${postedRes.json.error || ""}`);
  const postedLedger = tables.ledgerEntry.find(
    (row) => row.protectedTxnId === posted.id && row.entryType === "FINAL_TRANSFER",
  );
  assert(postedLedger?.stripeMode === "TEST", "TEST GP payout ledger uses the transaction mode");
  assert(postedLedger.amountMinor === 3500, "TEST GP payout ledger amount stays 3500");
  assert(postedLedger.stripeObjectType === "outbound_payment", "TEST GP payout ledger type stays outbound");

  const liveTxn = gpTxn({
    stripeMode: "LIVE",
    status: "READY_TO_RELEASE",
    payoutRailLockedAt: new Date(),
  });
  tables.outboundPaymentAttempt.push({
    id: "attempt_live_ledger",
    protectedTxnId: liveTxn.id,
    kind: "FINAL",
    status: "PROCESSING",
    amountMinor: 3500,
    currency: "gbp",
    stripeMode: "LIVE",
    idempotencyKey: `final_gp_${liveTxn.id}_terms35`,
    fxRateSnapshot: "",
    stripeOutboundPaymentId: "",
    destinationCurrency: "",
    destinationAmountMinor: 0,
    providerFeeMinor: 0,
    crossBorderFeeMinor: 0,
    fxFeeMinor: 0,
  });
  const liveFinal = await finalizeOutboundSuccess({
    attemptId: "attempt_live_ledger",
    outboundId: "obp_live_ledger",
    txn: liveTxn,
    status: "READY_TO_RELEASE",
    domainAction: "RELEASE_FINAL",
    kind: "FINAL",
    amount: 3500,
    idempotencyKey: `final_gp_${liveTxn.id}_terms35`,
    isFullResidual: true,
  });
  assert(liveFinal.alreadyReleased === false, "LIVE finalize did not book the payout");
  const liveLedger = tables.ledgerEntry.find(
    (row) => row.protectedTxnId === liveTxn.id && row.entryType === "FINAL_TRANSFER",
  );
  assert(liveLedger?.stripeMode === "LIVE", "genuine LIVE payout ledger stays LIVE");
  assert(liveLedger.amountMinor === 3500, "LIVE payout ledger amount stays 3500");
  assert(liveLedger.stripeObjectId === "obp_live_ledger", "LIVE payout ledger keeps its provider reference");
}

assert(process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED === "false", "live initiation flag restored");
console.log("gp test release route: PASS");
