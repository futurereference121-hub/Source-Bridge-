/**
 * Unit checks for messaging timeline helpers and homepage CTA copy.
 * Run: node scripts/test-performance-messaging-cta.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

// Homepage CTA
{
  const hero = read("src/components/home/HeroActions.tsx");
  assert.ok(
    !/Start Earning/i.test(hero),
    "Old Start Earning CTA must be removed",
  );
  assert.ok(
    !/Start earning from your location now/i.test(hero),
    "Scheme-like earning CTA must be absent",
  );
  assert.ok(/Join Source Bridge/.test(hero), "Join Source Bridge CTA required");
  assert.ok(
    /Your location could be exactly what someone needs/.test(hero),
    "Supporting mission line required",
  );
  assert.ok(/Sign In/.test(hero), "Sign In secondary action required");
}

// Timeline: sticky sourcing card removed; SOURCING_REQUEST rendered inline
{
  const inbox = read("src/components/messaging/MessagesInbox.tsx");
  assert.ok(
    !/activeConversation\?\.sourcingRequest \? \(/.test(inbox),
    "Sticky sourcingRequest card must not pin to top of timeline",
  );
  assert.ok(
    /messageType === "SOURCING_REQUEST"/.test(inbox),
    "SOURCING_REQUEST messages must render inline",
  );
  assert.ok(
    /activeId \? "hidden lg:flex"/.test(inbox) ||
      /activeId \? "hidden lg:flex" : "flex/.test(inbox),
    "Mobile must hide inbox list while thread is open",
  );
  assert.ok(/draftByConversation/.test(inbox), "Drafts must be per-conversation");
}

// Navigation feedback present
{
  const shell = read("src/components/layout/SiteShell.tsx");
  assert.ok(/NavigationProgress/.test(shell), "Navigation progress required");
}

// Sourcing request must not keep stale listing on reuse
{
  const route = read("src/app/api/sourcing-requests/route.ts");
  assert.ok(
    !/listingId: listingId \?\? conversation\.listingId/.test(route),
    "Must not preserve previous listingId when new request has none",
  );
  assert.ok(
    /listingId: listingId \?\? null/.test(route),
    "New request listingId must clear or set explicitly",
  );
}

// Chronological sort helper (stable secondary by id)
{
  function sortTimeline(items) {
    return [...items].sort((a, b) => {
      const at = Date.parse(a.createdAt);
      const bt = Date.parse(b.createdAt);
      if (at !== bt) return at - bt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  const items = [
    { id: "c", createdAt: "2026-07-01T12:00:02.000Z", kind: "reply" },
    { id: "a", createdAt: "2026-07-01T12:00:00.000Z", kind: "msg" },
    { id: "b", createdAt: "2026-07-01T12:00:01.000Z", kind: "request" },
    { id: "d", createdAt: "2026-07-01T12:00:01.000Z", kind: "msg" },
  ];
  const sorted = sortTimeline(items).map((i) => i.id);
  assert.deepEqual(sorted, ["a", "b", "d", "c"]);
}

console.log("test-performance-messaging-cta: ok");
