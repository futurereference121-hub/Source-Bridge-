/**
 * Run a list of node test scripts sequentially. Fail on first non-zero.
 * No Stripe network calls — callers must only pass offline unit scripts.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function runNodeTestScripts(scripts, { label = "suite" } = {}) {
  console.log(`\n[${label}] ${scripts.length} script(s)\n`);
  for (const rel of scripts) {
    const abs = path.join(root, rel);
    console.log(`\n=== ${rel} ===\n`);
    const result = spawnSync(process.execPath, [abs], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    if (result.error) {
      console.error(result.error);
      process.exit(1);
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
  console.log(`\n[${label}] passed\n`);
}
