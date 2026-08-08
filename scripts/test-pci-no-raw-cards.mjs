/**
 * PCI / raw-card pattern scan for executable scripts.
 * Run: node scripts/test-pci-no-raw-cards.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve("scripts");
const FORBIDDEN = [
  /4242[\s\-]?4242[\s\-]?4242[\s\-]?4242/,
  /4000000000000002/,
  /4000000000009995/,
  /number:\s*['"]?\d{13,19}/i,
  /cvc:\s*['"]?\d{3,4}/i,
];
const SKIP = new Set(["test-pci-no-raw-cards.mjs"]);
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith("tmp-") || name.startsWith("tmp_")) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(mjs|js|ts|ps1|sh)$/.test(name)) out.push(full);
  }
  return out;
}
const files = walk(ROOT);
const hits = [];
for (const file of files) {
  const base = path.basename(file);
  if (SKIP.has(base)) continue;
  if (base.includes("stripe-test-topup")) { hits.push(base + ": topup script name"); continue; }
  const text = fs.readFileSync(file, "utf8");
  for (const re of FORBIDDEN) {
    if (re.test(text)) hits.push(base + ": " + re);
  }
}
assert.equal(hits.length, 0, "Raw card patterns:\n" + hits.join("\n"));
console.log("test-pci-no-raw-cards: OK (" + files.length + " scripts scanned)");