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

const profile = read("src/app/profile/page.tsx");
assert.match(profile, /idempotencyKey/);
assert.match(profile, /Publishing…/);
assert.match(profile, /status-cooldown/);
assert.match(profile, /emitStatusChanged/);

console.log("[test-status-rate-limits] passed");
