/**
 * Approved Sandbox pair: real ticket form, real create route, mocked auth/db.
 * No Stripe, no Production database, no ticket creation outside the mock.
 *
 * Run: node scripts/test-gp-sandbox-ticket-form.mjs
 */
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (process.env.SB_GP_FORM_TEST !== "1") {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /SECRET|TOKEN|KEY|DATABASE|POSTGRES|NEON|STRIPE|PASSWORD|COOKIE|AUTH/i.test(key)
    ) {
      delete env[key];
    }
  }
  env.SB_GP_FORM_TEST = "1";
  env.NODE_ENV = "test";
  env.SESSION_SECRET = "sandbox-ticket-form-test-secret";
  env.DATABASE_URL = "postgresql://mock:mock@127.0.0.1:9/mock";
  env.PAYMENTS_ENABLED = "true";
  env.PROTECTED_PAYMENTS_ENABLED = "true";
  env.LIVE_PAYMENTS_ENABLED = "true";
  env.GLOBAL_PAYOUTS_ENABLED = "true";
  env.GLOBAL_PAYOUTS_SANDBOX_ENABLED = "true";
  env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED = "false";
  env.GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST = "TH";
  env.GP_SANDBOX_APPROVED_BUYER_ID = `c${"a".repeat(24)}`;
  env.GP_SANDBOX_APPROVED_SOURCER_ID = `c${"b".repeat(24)}`;
  env.GP_SANDBOX_CURRENCY = "gbp";
  env.GP_SANDBOX_MAX_AMOUNT_MINOR = "5000";
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
const PAIR_CONVERSATION = `c${"1".repeat(24)}`;
const ORDINARY_CONVERSATION = `c${"2".repeat(24)}`;

function userRow(id, username) {
  return {
    id,
    email: `${username}@example.test`,
    name: username,
    username,
    slug: username,
    photo: "",
    passwordHash: "hashed",
    deletedAt: null,
    emailVerified: new Date(),
    onboardingComplete: true,
    mustChangePassword: false,
    isDemo: false,
    isTestAccount: false,
    isAdmin: false,
    role: "USER",
    trustLevel: 3,
    procurementAdvancesEnabled: false,
    identityVerified: true,
    memberType: "MEMBER",
    intent: "",
    specialties: "",
    isDiscoverable: true,
    notificationSoundsEnabled: true,
    notificationVolume: 1,
    country: "TH",
    createdAt: new Date(),
  };
}

function conversationRow(id, a, b) {
  const now = new Date();
  return {
    id,
    subject: "Chat",
    contextType: "direct",
    disputeCaseId: null,
    paymentTicketId: null,
    listingId: null,
    opportunityId: null,
    sourcingRequestId: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: null,
    activityVersion: 1,
    participants: [a, b].map((userId) => ({
      conversationId: id,
      userId,
      leftAt: null,
      lastReadAt: null,
      hiddenAt: null,
      deletedBeforeAt: null,
      user: {
        id: userId,
        name: state.users.get(userId).name,
        username: state.users.get(userId).username,
        slug: state.users.get(userId).slug,
        photo: "",
        deletedAt: null,
      },
    })),
    messages: [],
    sourcingRequest: null,
    listing: null,
  };
}

const state = {
  actorId: BUYER,
  users: new Map([
    [BUYER, userRow(BUYER, "futureman")],
    [SOURCER, userRow(SOURCER, "luckyday")],
    [OTHER_A, userRow(OTHER_A, "buyerordinary")],
    [OTHER_B, userRow(OTHER_B, "sourcerordinary")],
  ]),
  conversations: new Map(),
  tickets: [],
  calls: [],
};

state.conversations.set(PAIR_CONVERSATION, conversationRow(PAIR_CONVERSATION, BUYER, SOURCER));
state.conversations.set(
  ORDINARY_CONVERSATION,
  conversationRow(ORDINARY_CONVERSATION, OTHER_A, OTHER_B),
);

function dispatch(model, method, args) {
  state.calls.push(`${model}.${method}`);
  if (state.calls.length > 400) state.calls.shift();
  if (model === "session" && method === "findUnique") {
    const actor = state.users.get(state.actorId);
    if (!actor) return null;
    return {
      id: "session-1",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      user: actor,
    };
  }
  if (model === "user" && (method === "findUnique" || method === "findUniqueOrThrow")) {
    const row = state.users.get(args?.where?.id) || null;
    if (!row && method === "findUniqueOrThrow") {
      throw Object.assign(new Error("User not found"), { code: "P2025" });
    }
    return row;
  }
  if (model === "user" && method === "findMany") {
    const ids = args?.where?.id?.in;
    if (Array.isArray(ids)) return ids.map((id) => state.users.get(id)).filter(Boolean);
    return [...state.users.values()];
  }
  if (model === "conversation" && method === "findUnique") {
    return state.conversations.get(args?.where?.id) || null;
  }
  if (model === "conversation" && method === "update") {
    return { activityVersion: 2 };
  }
  if (model === "conversationParticipant" && method === "findUnique") {
    const key = args?.where?.conversationId_userId;
    const conv = key ? state.conversations.get(key.conversationId) : null;
    return conv?.participants.find((part) => part.userId === key.userId) || null;
  }
  if (model === "platformPaymentConfig" && (method === "upsert" || method === "findUnique")) {
    return {
      id: "default",
      protectionFeeBps: 700,
      protectionFeeFloorMinor: 0,
      directServiceFeeBps: 700,
      directServiceFeeFloorMinor: 0,
      inspectionHours: 12,
      procurementMinTrustLevel: 2,
      procurementAdvancesGloballyOn: false,
      allowedCurrenciesJson: "[]",
      stripePlatformCountry: "",
    };
  }
  if (model === "paymentTicket" && method === "create") {
    const row = {
      id: `tkt_${state.tickets.length + 1}`,
      notes: "",
      declineReason: "",
      buyerApprovedRevision: null,
      sellerApprovedRevision: null,
      buyerApprovedAt: null,
      sellerApprovedAt: null,
      declinedById: null,
      declinedAt: null,
      protectedTransactionId: null,
      hiddenFromChatAt: null,
      listingId: null,
      sourcingRequestId: null,
      platformFeeIncludedInPrice: false,
      procurementAdvanceAgreed: false,
      procurementAdvanceMinor: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastMeaningfulActivityAt: new Date(),
      ...args.data,
    };
    state.tickets.push(row);
    return row;
  }
  if (model === "paymentTicket" && method === "findMany") return [];
  if (model === "paymentTicket" && method === "findUnique") return null;
  if (method === "findMany" || method === "findFirst") return method === "findMany" ? [] : null;
  if (method === "count") return 0;
  if (method === "aggregate") return { _max: {} };
  if (method === "updateMany" || method === "deleteMany") return { count: 0 };
  if (method === "create") return { id: `${model}_row`, ...(args?.data || {}) };
  if (method === "update") return { ...(args?.data || {}), activityVersion: 2 };
  if (method === "findUnique" || method === "findUniqueOrThrow") return null;
  return null;
}

globalThis.__SB_PRISMA = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === "$transaction") {
        return async (arg) =>
          typeof arg === "function" ? arg(globalThis.__SB_PRISMA) : Promise.all(arg);
      }
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

globalThis.__SB_COOKIE_VALUES = { sb_session: signCookie("sandbox-ticket-form-token") };
globalThis.__SB_COOKIE_JAR = {
  get(name) {
    const value = globalThis.__SB_COOKIE_VALUES[name];
    return value ? { name, value } : undefined;
  },
  set() {},
  delete() {},
  has(name) {
    return Boolean(globalThis.__SB_COOKIE_VALUES[name]);
  },
  getAll() {
    return Object.entries(globalThis.__SB_COOKIE_VALUES).map(([name, value]) => ({ name, value }));
  },
};

function assert(cond, message) {
  if (!cond) {
    const err = new Error(message);
    err.calls = state.calls.slice(-40);
    throw err;
  }
}

async function readCurrency(page) {
  const select = page.locator("select.ticket-currency-select");
  await select.waitFor({ timeout: 15000 });
  const value = await select.inputValue();
  const options = await select.locator("option").evaluateAll((els) =>
    els.map((el) => ({ value: el.getAttribute("value"), label: (el.textContent || "").trim() })),
  );
  const selected = options.find((opt) => opt.value === value) || null;
  return { value, selectedLabel: selected?.label || "", options };
}

async function launchBrowser() {
  const { createRequire } = await import("node:module");
  const { chromium } = createRequire(path.join(root, "package.json"))("playwright");
  const channels = ["msedge", "chrome"];
  let last;
  for (const channel of channels) {
    try {
      return await chromium.launch({ headless: true, channel });
    } catch (err) {
      last = err;
    }
  }
  throw last || new Error("No Edge or Chrome browser is available for the form test");
}

async function bundleForm(dir) {
  const { createRequire } = await import("node:module");
  const webpack = createRequire(path.join(root, "package.json"))(
    "next/dist/compiled/webpack/webpack.js",
  );
  webpack.init();
  const loaderPath = path.join(dir, "swc-loader.cjs");
  const harnessPath = path.join(dir, "harness.tsx");
  fs.writeFileSync(
    loaderPath,
    `const { createRequire } = require("module");
const { transformSync } = createRequire(${JSON.stringify(path.join(root, "package.json"))})("next/dist/build/swc");
module.exports = function (source) {
  const filename = this.resourcePath;
  const result = transformSync(source, {
    filename,
    jsc: {
      parser: { syntax: "typescript", tsx: filename.endsWith(".tsx") },
      transform: { react: { runtime: "automatic" } },
      target: "es2022",
    },
    module: { type: "es6" },
  });
  return result.code;
};
`,
  );
  fs.writeFileSync(
    harnessPath,
    `import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProposePaymentTicketButton } from "@/components/messaging/ProposePaymentTicketButton";

function Harness() {
  const [props, setProps] = useState(window.__BOOT);
  useEffect(() => {
    window.__setProps = (next) => setProps((prev) => ({ ...prev, ...next }));
  }, []);
  return (
    <ProposePaymentTicketButton
      conversationId={props.conversationId}
      myId={props.myId}
      otherUserId={props.otherUserId}
      otherUsername={props.otherUsername}
      proposalAccess={props.proposalAccess}
      forceOpen
    />
  );
}

window.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/api/payments/connect")) {
    return new Response(JSON.stringify({
      ok: true,
      flags: {
        PROTECTED_PAYMENTS_ENABLED: true,
        INSTANT_PAYMENTS_ENABLED: false,
        PROCUREMENT_ADVANCES_ENABLED: false,
      },
      paymentsAccess: { testAccessAllowed: true, testRampOpen: true },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("/api/payments/tickets") && init && init.method === "POST") {
    window.__captured.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({
      ok: false,
      error: "Captured for the real route.",
      code: "TEST_CAPTURE",
    }), { status: 409, headers: { "Content-Type": "application/json" } });
  }
  return new Response("not found", { status: 404 });
};

createRoot(document.getElementById("root")).render(<Harness />);
`,
  );
  const config = {
    mode: "development",
    context: root,
    entry: harnessPath,
    output: { path: dir, filename: "bundle.js" },
    resolve: {
      extensions: [".tsx", ".ts", ".js", ".mjs"],
      modules: [path.join(root, "node_modules"), "node_modules"],
      alias: { "@": path.join(root, "src") },
    },
    module: {
      rules: [{ test: /\.[cm]?tsx?$/, exclude: /node_modules/, use: [loaderPath] }],
    },
    devtool: false,
  };
  await new Promise((resolve, reject) => {
    webpack.webpack(config, (err, stats) => {
      if (err) return reject(err);
      if (stats.hasErrors()) return reject(new Error(stats.toJson().errors.map((e) => e.message).join("\n")));
      resolve();
    });
  });
  return fs.readFileSync(path.join(dir, "bundle.js"));
}

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function openForm(page, origin, boot) {
  page.__boot = boot;
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator("select.ticket-currency-select").waitFor({ timeout: 15000 });
}

async function main() {
  const { GET } = await import("../src/app/api/conversations/[id]/route.ts");
  const { POST } = await import("../src/app/api/payments/tickets/route.ts");
  const { GP_GBP_FLAT_FEE_EXPLANATION } = await import("../src/lib/payments/gp-pricing.ts");
  const { readGpSandboxPair } = await import("../src/lib/payments/payout-rail/sandbox-pair.ts");
  const { normalizeCurrency, roundBpsToMinor } = await import("../src/lib/payments/money.ts");

  async function loadAccess(conversationId, actorId) {
    state.actorId = actorId;
    const res = await GET(new Request(`http://form.test/api/conversations/${conversationId}`), {
      params: Promise.resolve({ id: conversationId }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(`conversation eligibility ${res.status}: ${JSON.stringify(json)}`);
    }
    return json.paymentsProposalAccess;
  }

  const pairAccess = await loadAccess(PAIR_CONVERSATION, BUYER);
  assert(pairAccess?.ticketCurrency?.currency === "GBP", "pair eligibility currency");
  assert(pairAccess.ticketCurrency.buyerId === BUYER, "pair eligibility buyer");
  assert(pairAccess.ticketCurrency.sellerId === SOURCER, "pair eligibility sourcer");
  const ordinaryAccess = await loadAccess(ORDINARY_CONVERSATION, OTHER_A);
  assert(ordinaryAccess?.ticketCurrency == null, "ordinary eligibility has no currency lock");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ticket-form-"));
  const bundle = await bundleForm(dir);
  const server = await listen((req, res) => {
    if (req.url === "/bundle.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(bundle);
      return;
    }
    const boot = server.__boot;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html><body><div id="root"></div>
<script>window.__BOOT = ${JSON.stringify(boot)}; window.__captured = [];</script>
<script src="/bundle.js"></script></body></html>`);
  });
  const origin = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    server.__boot = {
      conversationId: PAIR_CONVERSATION,
      myId: BUYER,
      otherUserId: SOURCER,
      otherUsername: "luckyday",
      proposalAccess: pairAccess,
    };
    await openForm(page, origin, server.__boot);
    const beforeRole = await readCurrency(page);
    await page.getByRole("radio", { name: "Me", exact: true }).check();
    const asBuyer = await readCurrency(page);
    await page.getByRole("radio", { name: "@luckyday", exact: true }).check();
    const reversed = await readCurrency(page);
    await page.evaluate(
      ({ otherUserId, proposalAccess }) => {
        window.__setProps({ otherUserId, otherUsername: "someone", proposalAccess });
      },
      { otherUserId: OTHER_B, proposalAccess: { ...pairAccess, ticketCurrency: null } },
    );
    await page.getByRole("radio", { name: "Me", exact: true }).check();
    const otherCounterparty = await readCurrency(page);
    await page.evaluate((boot) => window.__setProps(boot), {
      otherUserId: SOURCER,
      otherUsername: "luckyday",
      proposalAccess: pairAccess,
    });
    await page.getByRole("radio", { name: "Me", exact: true }).check();
    const restored = await readCurrency(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId("ticket-edit-item-cost").fill("10");
    await page.getByTestId("ticket-minimum-entitlement").waitFor({ timeout: 5000 });
    await page.getByTestId("ticket-propose-submit").click();
    await page.waitForTimeout(200);
    assert((await page.evaluate(() => window.__captured.length)) === 0, "below-minimum form does not submit");
    await page.getByTestId("ticket-edit-item-cost").fill("35");
    const explanation = page.getByTestId("ticket-fee-explanation");
    await explanation.waitFor({ timeout: 5000 });
    const desktopText = await page.getByTestId("ticket-fee-preview").innerText();
    assert(desktopText.includes("5.25") && desktopText.includes("40.25"), `desktop fee preview ${desktopText}`);
    const explanationText = await explanation.innerText();
    assert(
      explanationText.trim() === GP_GBP_FLAT_FEE_EXPLANATION,
      `desktop explanation ${JSON.stringify(explanationText)}`,
    );
    const desktopBox = await explanation.boundingBox();
    assert(desktopBox && desktopBox.width > 80 && desktopBox.x >= 0 && desktopBox.x + desktopBox.width <= 1280, "desktop explanation fits");
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileBox = await explanation.boundingBox();
    assert(mobileBox && mobileBox.width > 40 && mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 394, "mobile explanation fits");
    await page.getByTestId("ticket-propose-submit").click();
    await page.waitForFunction(() => window.__captured.length === 1);
    const pairBody = (await page.evaluate(() => window.__captured))[0];

    server.__boot = {
      conversationId: ORDINARY_CONVERSATION,
      myId: OTHER_A,
      otherUserId: OTHER_B,
      otherUsername: "sourcerordinary",
      proposalAccess: ordinaryAccess,
    };
    await openForm(page, origin, server.__boot);
    const ordinaryBefore = await readCurrency(page);
    await page.getByRole("radio", { name: "Me", exact: true }).check();
    const ordinarySelected = await readCurrency(page);
    await page.getByTestId("ticket-edit-item-cost").fill("10");
    await page.getByTestId("ticket-propose-submit").click();
    await page.waitForFunction(() => window.__captured.length === 1);
    const ordinaryBody = (await page.evaluate(() => window.__captured))[0];

    state.actorId = BUYER;
    const pairRes = await POST(
      new Request("http://form.test/api/payments/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-proposal-trace-id": pairBody.proposalTraceId },
        body: JSON.stringify(pairBody),
      }),
    );
    const pairJson = await pairRes.json();
    assert(pairRes.status === 201, `GBP route status ${pairRes.status} ${JSON.stringify(pairJson)}`);
    const stored = state.tickets[0];
    const allowed = readGpSandboxPair();
    assert(stored.currency === "GBP", "stored currency");
    assert(stored.stripeMode === "TEST", "stored mode");
    assert(stored.payoutRail === "STRIPE_GLOBAL_PAYOUTS", "stored rail");
    assert(pairJson.ticket.currency === "GBP", "response currency");
    assert(pairJson.ticket.stripeMode === "TEST", "response mode");
    assert(pairJson.ticket.payoutRail === "STRIPE_GLOBAL_PAYOUTS", "response rail");
    assert(normalizeCurrency(pairBody.currency) === stored.currency, "normalized currency");
    assert(allowed?.currency === "GBP", "resolved allowed currency");
    const principal = stored.itemCostMinor + stored.shippingMinor + stored.sellerServiceFeeMinor;
    assert(principal === 3500, "£35 entitlement");
    assert(stored.protectionFeeMinor === 525, "flat fee");
    assert(stored.totalChargeMinor === 4025, "buyer total");
    assert(stored.pricingPolicy === "GP_GBP_FLAT_V1", "stored policy");
    assert(pairJson.ticket.protectionFeeMinor === 525, "response fee");
    assert(pairJson.ticket.totalChargeMinor === 4025, "response total");
    assert(
      pairJson.ticket.feeExplanation === GP_GBP_FLAT_FEE_EXPLANATION,
      "response explanation",
    );
    assert(pairBody.protectionFeeMinor == null && pairBody.pricingPolicy == null, "client does not send the fee");

    const belowMin = await POST(
      new Request("http://form.test/api/payments/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...pairBody, itemCostMinor: 1000, proposalTraceId: "below-min-trace" }),
      }),
    );
    const belowMinJson = await belowMin.json();
    assert(belowMin.status === 400 && belowMinJson.code === "GP_MINIMUM_ENTITLEMENT", `below min ${belowMin.status} ${belowMinJson.code}`);
    const forged = await POST(
      new Request("http://form.test/api/payments/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...pairBody, protectionFeeMinor: 1, proposalTraceId: "forged-fee-trace" }),
      }),
    );
    const forgedJson = await forged.json();
    assert(forged.status === 400 && forgedJson.code === "CLIENT_FEE_REJECTED", `forged fee ${forged.status} ${forgedJson.code}`);
    assert(state.tickets.length === 1, "rejected amounts were not stored");

    const rejectedBody = { ...pairBody, currency: "THB", proposalTraceId: "thb-rejected-trace" };
    const rejected = await POST(
      new Request("http://form.test/api/payments/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rejectedBody),
      }),
    );
    const rejectedJson = await rejected.json();
    assert(rejected.status === 409 && rejectedJson.code === "GP_SANDBOX_CURRENCY", "non-GBP rejected");
    assert(state.tickets.length === 1, "rejected currency was not stored");

    state.actorId = OTHER_A;
    const ordinaryRes = await POST(
      new Request("http://form.test/api/payments/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ordinaryBody),
      }),
    );
    const ordinaryJson = await ordinaryRes.json();
    assert(ordinaryRes.status === 201, `ordinary route ${ordinaryRes.status} ${JSON.stringify(ordinaryJson)}`);
    const ordinaryStored = state.tickets[1];
    assert(ordinaryStored.stripeMode === "LIVE", "ordinary mode");
    assert(ordinaryStored.payoutRail === "STRIPE_CONNECT", "ordinary rail");
    assert(ordinaryStored.currency === ordinaryBody.currency, "ordinary currency preserved");
    const ordinaryPrincipal =
      ordinaryStored.itemCostMinor + ordinaryStored.shippingMinor + ordinaryStored.sellerServiceFeeMinor;
    assert(ordinaryStored.protectionFeeMinor === roundBpsToMinor(ordinaryPrincipal, 700), "ordinary 7% fee");
    assert(!ordinaryStored.pricingPolicy, "ordinary policy empty");

    const trace = {
      visibleBeforeRole: beforeRole,
      visibleApprovedBuyer: asBuyer,
      visibleReversedRole: reversed,
      visibleOtherCounterparty: otherCounterparty,
      visibleRestoredPair: restored,
      requestCurrency: pairBody.currency,
      parsedCurrency: pairBody.currency,
      normalizedCurrency: stored.currency,
      allowedCurrency: allowed.currency,
      ticketMode: stored.stripeMode,
      payoutRail: stored.payoutRail,
      ordinaryVisible: ordinarySelected.value,
      ordinaryOfferedThb: ordinaryBefore.options.some((opt) => opt.value === "THB"),
      ordinaryMode: ordinaryStored.stripeMode,
      ordinaryRail: ordinaryStored.payoutRail,
      nonGbpStatus: rejected.status,
      nonGbpCode: rejectedJson.code,
      feeMinor: stored.protectionFeeMinor,
      principalMinor: principal,
    };
    console.log(JSON.stringify(trace, null, 2));
    assert(beforeRole.value === "EUR" && beforeRole.options.some((opt) => opt.value === "THB"), "unselected role keeps ordinary choices");
    assert(
      asBuyer.value === "GBP" && asBuyer.selectedLabel.startsWith("GBP") && asBuyer.options.length === 1,
      "approved role shows only GBP",
    );
    assert(reversed.options.some((opt) => opt.value === "THB") && reversed.value === "EUR", "reversed role restores ordinary choices");
    assert(otherCounterparty.value === "EUR" && otherCounterparty.options.length > 1, "counterparty change clears the lock");
    assert(restored.value === "GBP" && restored.options.length === 1, "returning to the pair restores GBP");
    assert(pairBody.currency === "GBP", "request currency");
    assert(ordinaryBefore.options.some((opt) => opt.value === "THB"), "ordinary form still offers THB");
    assert(ordinarySelected.value === "EUR", "ordinary default stays EUR");
    console.log("gp-sandbox-ticket-form: PASS");
  } finally {
    await page.close().catch(() => {});
    await Promise.race([
      browser.close(),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    server.closeAllConnections?.();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  if (err.calls) console.error(err.calls.join("\n"));
  process.exit(1);
});
