/**
 * Fallback helper: launch a dedicated Microsoft Edge window with remote debugging
 * so export.mjs can attach via Playwright connectOverCDP.
 *
 * Does NOT touch your everyday Edge profile.
 *
 * Usage:
 *   npm run wallapop:edge-debug
 * Then in another terminal:
 *   npm run wallapop:export -- --cdp
 */
import { spawn } from "child_process";
import { mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PROFILE = path.join(ROOT, "data", "wallapop-edge-debug-profile");
const CATALOG_URL = "https://es.wallapop.com/app/catalog/published";
const PORT = 9222;

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

function findEdge() {
  for (const p of EDGE_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function main() {
  const edge = findEdge();
  if (!edge) {
    console.error("Microsoft Edge not found in the usual install locations.");
    process.exit(1);
  }

  await mkdir(PROFILE, { recursive: true });

  console.log("Launching dedicated Edge debug session…");
  console.log(`  Executable: ${edge}`);
  console.log(`  Profile:    ${PROFILE}`);
  console.log(`  Debug port: ${PORT}`);
  console.log(`  URL:        ${CATALOG_URL}`);
  console.log("\nSign into Wallapop in that window if needed.");
  console.log("Then run:  npm run wallapop:export -- --cdp\n");

  const child = spawn(
    edge,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      "--no-first-run",
      "--no-default-browser-check",
      CATALOG_URL,
    ],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
  console.log(`Edge started (pid ${child.pid}). This helper will exit; keep the Edge window open.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
