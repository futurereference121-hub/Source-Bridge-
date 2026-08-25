/**
 * Status 3/day + 1-hour cooldown repair assertions.
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
const route = read("src/app/api/status/route.ts");
const editor = read("src/components/profile/editors/StatusEditor.tsx");

assert.match(limits, /STATUS_MIN_INTERVAL_MS = 60 \* 60 \* 1000/);
assert.match(limits, /DAILY_STATUS_LIMIT = 3/);
assert.match(route, /STATUS_COOLDOWN/);
assert.match(route, /STATUS_DAILY_LIMIT/);
assert.match(route, /existing: true/);
assert.match(route, /recordDailyAction/);
assert.match(route, /Idempotency BEFORE expire/);
assert.match(route, /You've used your 3 Status updates for today/);
assert.match(route, /You can update your Status again in/);
assert.match(editor, /Publishing…/);
assert.match(editor, /status-cooldown/);
assert.match(editor, /status-daily-limit/);
assert.match(editor, /publishDisabled/);
assert.match(editor, /used your 3 Status updates for today/);

const profile = read("src/app/profile/page.tsx");
assert.match(profile, /idempotencyKey/);
assert.match(profile, /Publishing…/);
assert.match(profile, /status-cooldown/);

console.log("[test-status-rate-limits] passed");
