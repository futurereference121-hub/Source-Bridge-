/**
 * Allowlist parse + match unit tests (mirrors src/lib/payments/allowlist.ts).
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

const buyer = "cms8or23a00001a046qm6ene4";
const seller = "cms62cfan0000ih04giwg7ee3";

assert.equal(normalizeAllowlistToken(`  "${buyer}"  `), buyer);
assert.equal(normalizeAllowlistToken(`'${seller}'`), seller);

let list = parseAllowlistRaw(`${buyer},${seller}`);
assert.equal(list.length, 2);
assert.equal(matches(list, { id: buyer }), true);
assert.equal(matches(list, { id: seller }), true);
assert.equal(matches(list, { id: "other" }), false);

list = parseAllowlistRaw(`"${buyer}", "${seller}"`);
assert.equal(matches(list, { id: buyer }), true);
assert.equal(matches(list, { id: seller }), true);

list = parseAllowlistRaw("futurereference121@gmail.com;theowlsaid420@gmail.com");
assert.equal(
  matches(list, { id: "zzz", email: "FutureReference121@gmail.com" }),
  true,
);

assert.equal(parseAllowlistRaw("").length, 0);
assert.equal(matches([], { id: buyer }), false);

console.log("allowlist tests passed");
