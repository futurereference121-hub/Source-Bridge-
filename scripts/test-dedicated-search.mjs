/**
 * Dedicated Search view + stale-query + handle normalization.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const page = read("src/app/search/page.tsx");
const client = read("src/app/search/SearchClient.tsx");
const members = read("src/lib/members-service.ts");
const site = read("src/lib/site.ts");
const explore = read("src/app/explore/ExploreClient.tsx");

assert.match(page, /SearchClient/);
assert.doesNotMatch(page, /ExploreClient/);
assert.match(client, /dedicated-search/);
assert.match(client, /search-live-results/);
assert.match(client, /requestSeq/);
assert.match(client, /AbortController/);
assert.match(client, /enableAutocomplete=\{false\}/);
assert.doesNotMatch(client, /LiveFeedSplit/);

assert.match(members, /regexp_replace\(lower\(username\)/);
assert.match(members, /normalizeSearchHandle/);
assert.match(members, /normalizedHandleIds/);

assert.match(site, /href: "\/search"/);
assert.match(explore, /requestSeq/);

console.log("[test-dedicated-search] passed");
