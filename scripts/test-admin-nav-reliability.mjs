/**
 * Admin tab navigation reliability — source assertions.
 * Ensures admin errors stay in-shell (no marketing homepage dump).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const layout = read("src/app/admin/layout.tsx");
const nav = read("src/app/admin/_components/AdminNav.tsx");
const err = read("src/app/admin/error.tsx");
const loading = read("src/app/admin/loading.tsx");
const mw = read("src/middleware.ts");

assert.match(layout, /AdminNav/);
assert.match(nav, /useTransition/);
assert.match(nav, /router\.push/);
assert.match(nav, /admin-nav/);
assert.match(nav, /Verification/);
assert.match(nav, /Protected Payments/);
assert.match(nav, /Reviews & Disputes/);
assert.doesNotMatch(nav, /Protected Purchases/);

assert.match(err, /admin-error/);
assert.match(err, /Retry/);
assert.doesNotMatch(err, /href=["']\/["']/);
assert.match(err, /\/admin\/verifications/);

assert.match(loading, /admin-loading/);
assert.match(loading, /SourceBridgeLoader/);

assert.match(mw, /hasSession/);
assert.match(mw, /sb_session/);
assert.match(
  mw,
  /if \(hasSession\) \{\s*return NextResponse\.next\(\);/s,
);

console.log("[test-admin-nav-reliability] passed");
