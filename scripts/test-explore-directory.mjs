/**
 * Explore directory + Live Activity layout (source assertions).
 * Run: node scripts/test-explore-directory.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const explore = read("src/app/explore/ExploreClient.tsx");
const page = read("src/app/explore/page.tsx");
const api = read("src/app/api/members/route.ts");
const service = read("src/lib/members-service.ts");
const card = read("src/components/members/MemberCard.tsx");
const split = read("src/components/explore/LiveFeedSplit.tsx");

assert.match(explore, /MemberDirectoryCard/);
assert.match(explore, /grid-cols-2/);
assert.match(explore, /Load more people/);
assert.match(explore, /append: true/);
assert.match(page, /listDirectoryMembersPage/);
assert.match(api, /searchParams.get\("page"\)/);
assert.match(api, /hasMore/);
assert.match(service, /listDirectoryMembersPage/);
assert.match(card, /export function MemberDirectoryCard/);
assert.match(split, /Independent floating Status \+ Opportunities cards/);
assert.doesNotMatch(
  explore,
  /Live Activity/,
  "Explore must not wrap Status+Opportunities in a shared Live Activity box",
);
assert.doesNotMatch(
  explore,
  /sm:grid-cols-2 sm:gap-6 xl:grid-cols-3/,
  "Explore people must not use the old 1-col full MemberCard grid on phones",
);

console.log("[test-explore-directory] passed");
