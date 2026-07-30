/**
 * Clean Vercel-pulled .env.local placeholders like [SENSITIVE]
 * without printing secret values. Keeps real tokens (e.g. BLOB_READ_WRITE_TOKEN).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";

const path = ".env.local";
if (!existsSync(path)) {
  console.error("missing .env.local");
  process.exit(1);
}

const original = readFileSync(path, "utf8");
const lines = original.split(/\r?\n/);
const kept = [];
const removed = [];

for (const line of lines) {
  const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) {
    kept.push(line);
    continue;
  }
  const key = m[1];
  let val = m[2];
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  if (val === "[SENSITIVE]" || val === "[Encrypted]" || val === "") {
    removed.push(key);
    continue;
  }
  kept.push(line);
}

writeFileSync(path, kept.join("\n") + (kept.at(-1) === "" ? "" : "\n"));
console.log("removed_placeholder_keys:", removed.join(", ") || "(none)");
console.log(
  "BLOB_READ_WRITE_TOKEN_still_present:",
  kept.some((l) => /^BLOB_READ_WRITE_TOKEN=/.test(l)),
);
