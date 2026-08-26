/**
 * Status rate-limit + write-path string/contract assertions.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const limits = read("src/lib/limits.ts");
const publish = read("src/lib/status-publish.ts");
const route = read("src/app/api/status/route.ts");
const editor = read("src/components/profile/editors/StatusEditor.tsx");
const sync = read("src/lib/status-surface-sync.ts");

assert.match(limits, /STATUS_MIN_INTERVAL_MS = 60 \* 60 \* 1000/);
assert.match(limits, /DAILY_STATUS_LIMIT = 3/);
assert.match(limits, /STATUS_TTL_MS = 24 \* 60 \* 60 \* 1000/);
assert.match(limits, /calendarDayKey/);

assert.match(publish, /publishStatusAtomic/);
assert.match(publish, /FOR UPDATE/);
assert.match(publish, /STATUS_DAILY_LIMIT/);
assert.match(publish, /STATUS_COOLDOWN/);
assert.match(publish, /existing: true/);
assert.match(publish, /rateLimitEvent\.create/);
assert.match(publish, /do not conflate|Do not conflate|Daily 3\/day/i);

assert.match(route, /publishStatusAtomic/);
assert.match(route, /revalidatePublicMemberSurfaces/);
assert.match(route, /result\.code/);
assert.match(publish, /STATUS_COOLDOWN/);
assert.match(publish, /STATUS_DAILY_LIMIT/);

assert.match(editor, /Publishing…/);
assert.match(editor, /status-cooldown/);
assert.match(editor, /status-daily-limit/);
assert.match(editor, /publishDisabled/);
assert.match(editor, /emitStatusChanged/);
assert.match(editor, /idempotencyKey/);

assert.match(sync, /STATUS_CHANGED_EVENT/);
assert.match(sync, /stale/);

const explore = read("src/app/explore/ExploreClient.tsx");
assert.match(explore, /refreshFeed/);
assert.match(explore, /subscribeStatusChanged/);
assert.match(explore, /subscribeOpportunityChanged/);
assert.match(explore, /softPollFeed|poll=1/);
assert.match(explore, /sinceVersion/);
assert.match(explore, /EXPLORE_FEED_SOFT_POLL_MS\s*=\s*2500/);
assert.match(explore, /visibilityState/);
assert.match(explore, /feedVersion|appliedFeedVersion/);
// Forbid aggressive full-feed timers (1–2s or fixed 4s refreshFeed loops).
assert.doesNotMatch(explore, /setTimeout\(\s*\(\)\s*=>\s*void refreshFeed\(\),\s*4000\)/);
assert.doesNotMatch(explore, /setInterval\(\s*\(\)\s*=>\s*void refreshFeed/);
assert.doesNotMatch(
  explore,
  /SOFT_POLL_MS\s*=\s*(1|2)000\b/,
);

const feedRoute = read("src/app/api/feed/route.ts");
assert.match(feedRoute, /poll/);
assert.match(feedRoute, /sinceVersion/);
assert.match(feedRoute, /getExploreFeedVersion|unchanged/);

const oppSync = read("src/lib/opportunity-surface-sync.ts");
assert.match(oppSync, /OPPORTUNITY_CHANGED_EVENT/);
assert.match(oppSync, /stale/);

const oppEditor = read("src/components/profile/editors/OpportunityEditor.tsx");
assert.match(oppEditor, /emitOpportunityChanged/);

const membersService = read("src/lib/members-service.ts");
assert.match(membersService, /dedupeStatusesByUser/);
assert.match(membersService, /statusFeed|statusItems/);

const memberStatus = read("src/lib/member-status.ts");
assert.match(memberStatus, /pickActiveStatus/);

const profile = read("src/app/profile/page.tsx");
assert.match(profile, /idempotencyKey/);
assert.match(profile, /Publishing…/);
assert.match(profile, /status-cooldown/);
assert.match(profile, /emitStatusChanged/);

const repro = read("scripts/_status-repro-signin.mjs");
assert.match(repro, /CLEANUP_FAILED|cleanupOk/);
assert.match(repro, /user\.delete/);
assert.doesNotMatch(repro, /leave-user/);

const observe = read("scripts/_status-postdeploy-observe.mjs");
assert.match(observe, /user\.delete/);
assert.doesNotMatch(observe, /leaveUser/);

console.log("[test-status-rate-limits] passed");
