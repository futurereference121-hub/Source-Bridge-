/**
 * Allowlist / open TEST ramp unit tests.
 * Run: node scripts/test-allowlist.mjs
 */
import assert from "node:assert/strict";

function normalizeAllowlistToken(raw) {
  return String(raw || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim()
    .toLowerCase();
}

function parseAllowlistRaw(envValue) {
  const raw = String(envValue || "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map(normalizeAllowlistToken)
    .filter(Boolean);
}

function matches(list, user) {
  if (!list.length) return false;
  const id = normalizeAllowlistToken(user.id || "");
  const email = normalizeAllowlistToken(user.email || "");
  if (id && list.includes(id)) return true;
  if (email && list.includes(email)) return true;
  return false;
}

/** Mirrors product: Live off + TEST → empty allowlist is open ramp; Live on → open. */
function assertPaymentsTestAllowlisted({ live, mode, list, users }) {
  const rampOpen = (!live && mode === "TEST") || live;
  if (rampOpen) {
    return { ok: true, reason: live ? "live-open" : "ramp-open" };
  }
  if (!list.length) {
    return { ok: false, reason: "empty-deny" };
  }
  for (const u of users) {
    if (!matches(list, u)) return { ok: false, reason: "denied", user: u.id };
  }
  return { ok: true, reason: "listed" };
}

const buyer = "cms8or23a0000la046qm6ene4";
const seller = "cms62cfan0000ih04giwg7ee3";
const ordinary = { id: "ordinary-acct-001", email: "ordinary@example.com" };

assert.equal(normalizeAllowlistToken(`  "${buyer}"  `), buyer);
assert.equal(normalizeAllowlistToken(`'${seller}'`), seller);

let list = parseAllowlistRaw(`${buyer},${seller}`);
assert.equal(list.length, 2);
assert.equal(matches(list, { id: buyer }), true);
assert.equal(matches(list, { id: seller }), true);
assert.equal(matches(list, { id: "other" }), false);

list = parseAllowlistRaw(`"${buyer}", "${seller}"`);
assert.equal(matches(list, { id: buyer }), true);

list = parseAllowlistRaw("futurereference121@gmail.com;theowlsaid420@gmail.com");
assert.equal(
  matches(list, { id: "zzz", email: "FutureReference121@gmail.com" }),
  true,
);

assert.equal(parseAllowlistRaw("").length, 0);
assert.equal(matches([], { id: buyer }), false);

// Open TEST ramp: empty list + Live off + TEST → ordinary account allowed
{
  const r = assertPaymentsTestAllowlisted({
    live: false,
    mode: "TEST",
    list: [],
    users: [ordinary, { id: buyer }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.reason, "ramp-open");
}

// Live production: empty list allows any eligible user
{
  const r = assertPaymentsTestAllowlisted({
    live: true,
    mode: "LIVE",
    list: [],
    users: [ordinary],
  });
  assert.equal(r.ok, true);
  assert.equal(r.reason, "live-open");
}

// Closed pre-Live staging: empty list denies
{
  const r = assertPaymentsTestAllowlisted({
    live: false,
    mode: "LIVE",
    list: [],
    users: [ordinary],
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "empty-deny");
}

console.log("allowlist tests passed");
