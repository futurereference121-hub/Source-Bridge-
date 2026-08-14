/**
 * Release-oriented local check: full payment regression + typecheck.
 * Does not deploy, does not call Stripe, does not run next build (use npm run build separately).
 * Run: npm run test:sourcebridge
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(label, args) {
  console.log(`\n=== ${label} ===\n`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("payments:full", [path.join(root, "scripts/test-payments-full.mjs")]);

console.log("\n=== typecheck ===\n");
const tsc = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsc", "--noEmit"],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

console.log("\n[test:sourcebridge] passed\n");
