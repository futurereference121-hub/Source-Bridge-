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
    return { kinds, lifecycle, expiry, normalize, validation, map };
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
    return { kinds, lifecycle, expiry, normalize, validation, map };
  }
}

const {
  kinds,
  lifecycle,
  expiry,
  normalize,
  validation,
  map,
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

console.log(`\n${passed} assertions passed`);
