/**
 * Structured Opportunities unit tests (no Stripe / Live / Ably).
 * Run: node --experimental-strip-types scripts/test-structured-opportunities.mjs
 * or via npm script when wired.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Prefer compiled TS via tsx if available; else dynamic import of source through next path.
async function load() {
  try {
    const kinds = await import("../src/lib/opportunities/kinds.ts");
    const lifecycle = await import("../src/lib/opportunities/lifecycle.ts");
    const expiry = await import("../src/lib/opportunities/expiry.ts");
    const normalize = await import("../src/lib/opportunities/normalize.ts");
    const validation = await import("../src/lib/opportunities/validation.ts");
    const map = await import("../src/lib/opportunities/map.ts");
    const presentation = await import("../src/lib/opportunities/presentation.ts");
    return { kinds, lifecycle, expiry, normalize, validation, map, presentation };
  } catch {
    // Fallback: register ts-node/tsx
    try {
      require("tsx/cjs");
    } catch {
      /* ignore */
    }
    const kinds = require("../src/lib/opportunities/kinds.ts");
    const lifecycle = require("../src/lib/opportunities/lifecycle.ts");
    const expiry = require("../src/lib/opportunities/expiry.ts");
    const normalize = require("../src/lib/opportunities/normalize.ts");
    const validation = require("../src/lib/opportunities/validation.ts");
    const map = require("../src/lib/opportunities/map.ts");
    const presentation = require("../src/lib/opportunities/presentation.ts");
    return { kinds, lifecycle, expiry, normalize, validation, map, presentation };
  }
}

const {
  kinds,
  lifecycle,
  expiry,
  normalize,
  validation,
  map,
  presentation,
} = await load();

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

// 1–3 kinds
ok("three creatable kinds", kinds.CREATABLE_OPPORTUNITY_KINDS.length === 3);
ok("legacy kind exists", kinds.isOpportunityKind("LEGACY_GENERAL"));
ok("labels present", kinds.OPPORTUNITY_KIND_LABELS.BUYER_REQUEST === "BUYER REQUEST");

// 4–10 lifecycle
ok("cannot resurrect FULFILLED→OPEN", !lifecycle.canTransitionLifecycle("FULFILLED", "OPEN"));
ok("cannot resurrect WITHDRAWN→OPEN", !lifecycle.canTransitionLifecycle("WITHDRAWN", "OPEN"));
ok("cannot resurrect EXPIRED→OPEN", !lifecycle.canTransitionLifecycle("EXPIRED", "OPEN"));
ok("OPEN→WITHDRAWN allowed", lifecycle.canTransitionLifecycle("OPEN", "WITHDRAWN"));
ok("OPEN→IN_DISCUSSION allowed", lifecycle.canTransitionLifecycle("OPEN", "IN_DISCUSSION"));
ok("terminal fulfilled", lifecycle.isTerminalLifecycle("FULFILLED"));
ok("public listable OPEN", lifecycle.isPubliclyListableLifecycle("OPEN"));
ok("public exclude EXPIRED", !lifecycle.isPubliclyListableLifecycle("EXPIRED"));

// 11–15 expiry defaults
const now = new Date("2026-09-08T12:00:00.000Z");
const br = expiry.computeOpportunityExpiresAt({
  kind: "BUYER_REQUEST",
  now,
});
ok(
  "buyer default 14d",
  br.getTime() === now.getTime() + 14 * 24 * 60 * 60 * 1000,
);
const so = expiry.computeOpportunityExpiresAt({
  kind: "SOURCING_OFFER",
  now,
});
ok(
  "sourcing default 30d",
  so.getTime() === now.getTime() + 30 * 24 * 60 * 60 * 1000,
);
const travelEnd = new Date("2026-10-01T23:59:59.000Z");
const tr = expiry.computeOpportunityExpiresAt({
  kind: "TRAVEL_OPPORTUNITY",
  now,
  travelEndAt: travelEnd,
});
ok("travel uses travel end", tr.getTime() === travelEnd.getTime());
ok(
  "pre-expiry window",
  expiry.isInPreExpiryWindow(new Date(now.getTime() + 24 * 60 * 60 * 1000), now),
);
ok("past expiry", expiry.isPastExpiry(new Date(now.getTime() - 1000), now));

// 16–20 normalize + cursor
ok("normalize place", normalize.normalizePlaceToken("  Bangkok  ") === "bangkok");
const cur = normalize.encodeCursor({
  postedAt: now.toISOString(),
  id: "abc",
  score: 12,
});
const dec = normalize.decodeCursor(cur);
ok("cursor roundtrip id", dec?.id === "abc");
ok("cursor roundtrip score", dec?.score === 12);
ok("bad cursor null", normalize.decodeCursor("!!!") === null);
ok(
  "stringify categories",
  normalize.stringifyStringArray(["A", "A", "  b  "]).includes("b"),
);

// 21–30 validation schemas
const buyer = validation.structuredOpportunityCreateSchema.safeParse({
  kind: "BUYER_REQUEST",
  title: "Need ceramics",
  description: "Looking for handmade ceramics",
  sourceCity: "Kyoto",
  sourceCountry: "Japan",
  deliveryCity: "London",
  deliveryCountry: "UK",
});
ok("buyer valid", buyer.success);

const buyerBad = validation.structuredOpportunityCreateSchema.safeParse({
  kind: "BUYER_REQUEST",
  title: "x",
  description: "Looking for handmade ceramics",
  sourceCity: "Kyoto",
  sourceCountry: "Japan",
  // missing delivery
});
ok("buyer requires delivery", !buyerBad.success);

const offer = validation.structuredOpportunityCreateSchema.safeParse({
  kind: "SOURCING_OFFER",
  title: "I can source watches",
  description: "Swiss watch sourcing",
  sourceCity: "Geneva",
  sourceCountry: "Switzerland",
});
ok("offer valid", offer.success);

const travel = validation.structuredOpportunityCreateSchema.safeParse({
  kind: "TRAVEL_OPPORTUNITY",
  destinationCity: "Bangkok",
  destinationCountry: "Thailand",
  travelStartAt: "2026-10-01T00:00:00.000Z",
  travelEndAt: "2026-10-10T23:59:59.000Z",
});
ok("travel valid", travel.success);

const travelBad = validation.structuredOpportunityCreateSchema.safeParse({
  kind: "TRAVEL_OPPORTUNITY",
  destinationCity: "Bangkok",
  destinationCountry: "Thailand",
  travelStartAt: "2026-10-10T00:00:00.000Z",
  travelEndAt: "2026-10-01T23:59:59.000Z",
});
ok("travel end after start", !travelBad.success);

ok(
  "legacy kind not creatable via union without matching",
  !validation.structuredOpportunityCreateSchema.safeParse({
    kind: "LEGACY_GENERAL",
    title: "x",
    description: "y",
    sourceCity: "a",
    sourceCountry: "b",
  }).success,
);

const q = validation.opportunityMarketplaceQuerySchema.safeParse({
  mode: "latest",
  limit: "10",
});
ok("marketplace query", q.success && q.data.limit === 10);

ok(
  "CTA buyer",
  kinds.responseCtaLabel("BUYER_REQUEST") === "I CAN HELP",
);
ok(
  "CTA offer",
  kinds.responseCtaLabel("SOURCING_OFFER") === "MESSAGE SOURCER",
);
ok(
  "CTA travel",
  kinds.responseCtaLabel("TRAVEL_OPPORTUNITY") === "ASK ABOUT THIS TRIP",
);

// 31–35 map / context snapshot (no raw IDs in context string)
const pub = map.mapOpportunityPublic({
  id: "cuid_secret_should_not_leak_in_context",
  userId: "user_secret",
  title: "Need tea",
  description: "Matcha from Uji",
  city: "Uji",
  country: "Japan",
  category: "Food",
  startsAt: null,
  expiresAt: new Date("2026-09-22T00:00:00.000Z"),
  closedAt: null,
  postedAt: now,
  updatedAt: now,
  kind: "BUYER_REQUEST",
  lifecycle: "OPEN",
  stateChangedAt: now,
  clientRequestId: null,
  renewCount: 0,
  renewedFromId: null,
  exposureScore: 0,
  lastExposedAt: null,
  preExpiryNotifiedAt: null,
  sourceCity: "Uji",
  sourceCountry: "Japan",
  deliveryCity: "NYC",
  deliveryCountry: "USA",
  originCity: "",
  originCountry: "",
  travelStartAt: null,
  travelEndAt: null,
  budgetMinMinor: 1000,
  budgetMaxMinor: 5000,
  budgetCurrency: "USD",
  quantity: "2",
  deliveryMode: "SHIP",
  alternativesOk: true,
  internationalShipping: null,
  localHandover: null,
  specialistDetails: "",
  sizeLimits: "",
  luggageRestrictions: "",
  notes: "",
  photosJson: "[]",
  categoriesJson: '["Food"]',
  marketsJson: "[]",
});
ok("map kind", pub.kind === "BUYER_REQUEST");
ok("map active", pub.active === true);
const ctx = map.buildOpportunityMessageContext(pub);
ok("context has title", ctx.includes("Need tea"));
ok("context no raw opportunity id", !ctx.includes("cuid_secret"));
ok("context draft note", ctx.includes("Draft only"));

// 36–40 legacy lifecycle resolution
const expired = map.resolveLifecycle({
  lifecycle: "OPEN",
  closedAt: null,
  expiresAt: new Date("2020-01-01T00:00:00.000Z"),
});
ok("resolve expired", expired === "EXPIRED");
const withdrawn = map.resolveLifecycle({
  lifecycle: "OPEN",
  closedAt: now,
  expiresAt: null,
});
ok("resolve withdrawn from closedAt", withdrawn === "WITHDRAWN");
ok("resolve kind fallback", map.resolveKind("nope") === "LEGACY_GENERAL");
ok("resolve kind buyer", map.resolveKind("BUYER_REQUEST") === "BUYER_REQUEST");

const renewAction = validation.opportunityLifecycleActionSchema.safeParse({
  action: "renew",
});
ok("renew action schema", renewAction.success);

// QA correction: presentation labels, quantity, delivery, markets (items 1–21 focused)
const buyerLines = presentation.buildCompactOpportunityLines({
  kind: "BUYER_REQUEST",
  sourceCity: "Kyoto",
  sourceCountry: "Japan",
  deliveryCity: "London",
  deliveryCountry: "UK",
  expiresAt: "2026-09-20T00:00:00.000Z",
  quantity: "3",
  budgetMinMinor: 1000,
  budgetMaxMinor: 5000,
  budgetCurrency: "USD",
  city: "PosterCity",
  country: "PosterLand",
});
ok(
  "buyer SOURCE FROM not poster city",
  buyerLines.some((l) => l.label === "SOURCE FROM" && l.value.includes("Kyoto")) &&
    !buyerLines.some((l) => l.value.includes("PosterCity")),
);
ok(
  "buyer DELIVER TO",
  buyerLines.some((l) => l.label === "DELIVER TO" && l.value.includes("London")),
);
ok(
  "buyer NEEDED BY",
  buyerLines.some((l) => l.label === "NEEDED BY"),
);
ok(
  "buyer QTY",
  buyerLines.some((l) => l.label === "QTY" && l.value === "3"),
);
ok(
  "buyer BUDGET absent from compact",
  !buyerLines.some((l) => l.label === "BUDGET"),
);
ok(
  "buyer compact has no currency leak",
  !buyerLines.some((l) => /USD|budget/i.test(`${l.label} ${l.value}`)),
);

const offerLines = presentation.buildCompactOpportunityLines({
  kind: "SOURCING_OFFER",
  sourceCity: "Geneva",
  sourceCountry: "Switzerland",
  expiresAt: "2026-10-01T00:00:00.000Z",
  internationalShipping: true,
  localHandover: true,
});
ok(
  "offer AVAILABLE IN",
  offerLines.some((l) => l.label === "AVAILABLE IN" && l.value.includes("Geneva")),
);
ok(
  "offer AVAILABLE UNTIL",
  offerLines.some((l) => l.label === "AVAILABLE UNTIL"),
);

const travelLines = presentation.buildCompactOpportunityLines({
  kind: "TRAVEL_OPPORTUNITY",
  originCity: "Berlin",
  originCountry: "Germany",
  city: "Bangkok",
  country: "Thailand",
  travelStartAt: "2026-10-01T00:00:00.000Z",
  travelEndAt: "2026-10-10T00:00:00.000Z",
  markets: ["Chatuchak", "Weekend flea"],
  internationalShipping: false,
  localHandover: true,
}, { includeMarkets: true });
ok(
  "travel TRAVELLING origin→dest",
  travelLines.some((l) => l.label === "TRAVELLING" && l.value.includes("Berlin") && l.value.includes("Bangkok")),
);
ok(
  "travel TRAVEL DATES labelled",
  travelLines.some((l) => l.label === "TRAVEL DATES"),
);
ok(
  "travel markets in expanded compact when fits",
  travelLines.some((l) => l.label === "MARKETS"),
);

const legacyLines = presentation.buildCompactOpportunityLines({
  kind: "LEGACY_GENERAL",
  city: "Lisbon",
  country: "Portugal",
});
ok(
  "legacy neutral LOCATION",
  legacyLines.some((l) => l.label === "LOCATION" && l.value.includes("Lisbon")),
);
ok(
  "legacy badge OPPORTUNITY",
  presentation.opportunityKindBadgeLabel("LEGACY_GENERAL") === "OPPORTUNITY",
);

ok(
  "qty empty ok",
  presentation.normalizeOpportunityQuantity("").ok &&
    presentation.normalizeOpportunityQuantity("").value === "",
);
ok(
  "qty positive ok",
  presentation.normalizeOpportunityQuantity("4").ok &&
    presentation.normalizeOpportunityQuantity("4").value === "4",
);
ok(
  "qty does not default to 1",
  presentation.normalizeOpportunityQuantity("").value !== "1",
);
ok(
  "qty rejects zero",
  !presentation.normalizeOpportunityQuantity("0").ok,
);
ok(
  "qty rejects decimal",
  !presentation.normalizeOpportunityQuantity("1.5").ok,
);

ok(
  "delivery options three",
  presentation.DELIVERY_MODE_OPTIONS.length === 3,
);
ok(
  "delivery SHIP label",
  presentation.deliveryModeLabel("SHIP") === "Shipping",
);
ok(
  "delivery HAND label",
  presentation.deliveryModeLabel("HAND") === "Hand-delivery / local handover",
);
ok(
  "delivery EITHER label",
  presentation.deliveryModeLabel("EITHER") === "Either / not sure",
);

const buyerQtyBad = validation.structuredOpportunityCreateSchema.safeParse({
  kind: "BUYER_REQUEST",
  title: "Need ceramics",
  description: "Looking for handmade ceramics",
  sourceCity: "Kyoto",
  sourceCountry: "Japan",
  deliveryCity: "London",
  deliveryCountry: "UK",
  quantity: "0",
});
ok("buyer rejects qty 0", !buyerQtyBad.success);

const buyerQtyOk = validation.structuredOpportunityCreateSchema.safeParse({
  kind: "BUYER_REQUEST",
  title: "Need ceramics",
  description: "Looking for handmade ceramics",
  sourceCity: "Kyoto",
  sourceCountry: "Japan",
  deliveryCity: "London",
  deliveryCountry: "UK",
  quantity: "2",
  deliveryMode: "HAND",
});
ok("buyer qty 2 + HAND", buyerQtyOk.success);

const travelMarkets = validation.structuredOpportunityCreateSchema.safeParse({
  kind: "TRAVEL_OPPORTUNITY",
  destinationCity: "Bangkok",
  destinationCountry: "Thailand",
  travelStartAt: "2026-10-01T00:00:00.000Z",
  travelEndAt: "2026-10-10T23:59:59.000Z",
  markets: ["Chatuchak", "Vintage district"],
});
ok("travel markets persist schema", travelMarkets.success);

const marketsNorm = presentation.normalizeMarketsInput("Chatuchak,  Weekend flea\nChatuchak");
ok(
  "markets normalize unique",
  marketsNorm.length === 2 && marketsNorm[0] === "Chatuchak",
);

ok(
  "feed id parse",
  presentation.parseOpportunityIdFromFeedItemId("opp-abc123") === "abc123",
);

ok(
  "context source from not bare location",
  ctx.includes("Source from:") && !ctx.includes("Location: Uji"),
);
ok("context quantity", ctx.includes("Quantity: 2"));

// Access / privacy / return-path corrections (items 1–35 focused coverage)
const teaser = await import("../src/lib/opportunities/public-teaser.ts").catch(
  () => require("../src/lib/opportunities/public-teaser.ts"),
);

const fullPub = {
  id: "cuid_secret",
  kind: "BUYER_REQUEST",
  kindLabel: "BUYER REQUEST",
  lifecycle: "OPEN",
  title: "Need camera",
  summary: "Need camera",
  description: "Full private description with notes-level detail",
  city: "Kyoto",
  country: "Japan",
  category: "cameras",
  categories: ["cameras"],
  markets: [],
  photos: ["/x.jpg"],
  sourceCity: "Kyoto",
  sourceCountry: "Japan",
  deliveryCity: "London",
  deliveryCountry: "UK",
  originCity: "",
  originCountry: "",
  startsAt: null,
  expiresAt: "2026-09-20T00:00:00.000Z",
  closedAt: null,
  travelStartAt: null,
  travelEndAt: null,
  postedAt: "2026-09-10T00:00:00.000Z",
  budgetMinMinor: 10000,
  budgetMaxMinor: 50000,
  budgetCurrency: "USD",
  quantity: "2",
  deliveryMode: "EITHER",
  alternativesOk: true,
  internationalShipping: null,
  localHandover: null,
  specialistDetails: "secret specialist",
  sizeLimits: "secret size",
  luggageRestrictions: "secret luggage",
  notes: "secret notes",
  active: true,
  responseCta: "I CAN HELP",
  renewCount: 0,
};

const summary = teaser.mapOpportunitySummary(fullPub);
ok("summary redacts budget min", summary.budgetMinMinor == null);
ok("summary redacts budget max", summary.budgetMaxMinor == null);
ok("summary redacts budget currency", !summary.budgetCurrency);
ok("summary redacts notes", summary.notes === "");
ok("summary redacts specialist", summary.specialistDetails === "");
ok("summary keeps title", summary.title === "Need camera");
ok("summary keeps quantity", summary.quantity === "2");
ok("summary keeps CTA label", summary.responseCta === "I CAN HELP");

const feedSan = teaser.sanitizeOpportunityFeedItem({
  id: "opp-1",
  kind: "opportunity",
  memberId: "m1",
  memberSlug: "user",
  username: "user",
  fullName: "User",
  photo: "/p.jpg",
  text: "Need camera",
  postedAt: "2026-09-10T00:00:00.000Z",
  budgetMinMinor: 10000,
  budgetMaxMinor: 50000,
  budgetCurrency: "USD",
  quantity: "2",
});
ok(
  "feed sanitize drops budget",
  feedSan.budgetMinMinor === undefined &&
    feedSan.budgetMaxMinor === undefined &&
    feedSan.budgetCurrency === undefined,
);
ok("feed sanitize keeps quantity", feedSan.quantity === "2");

ok(
  "auth return keeps opportunity id",
  teaser.opportunityAuthReturnPath("abc123", "/explore") ===
    "/explore?id=abc123",
);
ok(
  "auth return rejects protocol-relative",
  teaser.safeOpportunityReturnPath("//evil.com") === "/explore",
);
ok(
  "auth return rejects absolute external",
  teaser.safeOpportunityReturnPath("https://evil.com") === "/explore",
);
ok(
  "auth return rejects admin",
  teaser.safeOpportunityReturnPath("/admin/payments") === "/explore",
);
ok(
  "auth return allows opportunities deep link",
  teaser.safeOpportunityReturnPath("/opportunities?id=x") ===
    "/opportunities?id=x",
);

const legacy = map.mapOpportunityLegacyCompat({
  id: "legacy1",
  userId: "u1",
  kind: "BUYER_REQUEST",
  lifecycle: "OPEN",
  title: "Legacy title",
  description: "Full desc",
  city: "Kyoto",
  country: "Japan",
  category: "x",
  categoriesJson: "[]",
  photosJson: "[]",
  marketsJson: "[]",
  sourceCity: "Kyoto",
  sourceCountry: "Japan",
  deliveryCity: "London",
  deliveryCountry: "UK",
  originCity: "",
  originCountry: "",
  startsAt: null,
  expiresAt: null,
  closedAt: null,
  travelStartAt: null,
  travelEndAt: null,
  postedAt: now,
  budgetMinMinor: 9999,
  budgetMaxMinor: 19999,
  budgetCurrency: "EUR",
  quantity: "1",
  deliveryMode: "SHIP",
  alternativesOk: true,
  internationalShipping: null,
  localHandover: null,
  specialistDetails: "nope",
  sizeLimits: "",
  luggageRestrictions: "",
  notes: "private note",
  renewCount: 0,
  clientRequestId: null,
  exposureScore: 0,
  lastExposedAt: null,
  preExpiryNotifiedAt: null,
  stateChangedAt: now,
});
ok("legacy compat hides budget", legacy.budgetMinMinor == null);
ok("legacy compat hides notes", legacy.notes === "");
ok(
  "detail budget formatter still works",
  presentation.formatOpportunityBudget({
    budgetMinMinor: 1000,
    budgetMaxMinor: 5000,
    budgetCurrency: "USD",
  })?.includes("USD"),
);
ok(
  "I CAN HELP CTA preserved",
  kinds.responseCtaLabel("BUYER_REQUEST") === "I CAN HELP",
);
ok(
  "MESSAGE SOURCER CTA preserved",
  kinds.responseCtaLabel("SOURCING_OFFER") === "MESSAGE SOURCER",
);
ok(
  "ASK ABOUT THIS TRIP CTA preserved",
  kinds.responseCtaLabel("TRAVEL_OPPORTUNITY") === "ASK ABOUT THIS TRIP",
);

console.log(`\n${passed} assertions passed`);

