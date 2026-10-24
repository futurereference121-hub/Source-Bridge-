/**
 * Serving-runtime diagnostic. Offline. No Stripe network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (process.env.SB_RUNTIME_DIAG_TEST !== "1") {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", fileURLToPath(import.meta.url)],
    {
      cwd: root,
      env: { ...process.env, SB_RUNTIME_DIAG_TEST: "1", NODE_ENV: "test" },
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const diagnostic = await import(
  pathToFileURL(path.join(root, "src/lib/payments/runtime-diagnostic.ts")).href
);
assert.deepEqual(
  diagnostic.runtimeDiagnostic({ VERCEL_GIT_COMMIT_SHA: "4c4ecb9594b79d4721f329c0f28087e2f4d38439" }, "v24.22.1"),
  {
    nodeVersion: "v24.22.1",
    deploymentSha: "4c4ecb9594b79d4721f329c0f28087e2f4d38439",
  },
);
assert.equal(diagnostic.servingDeploymentSha({ VERCEL_GIT_COMMIT_SHA: "not-a-sha" }), null);
assert.deepEqual(Object.keys(diagnostic.runtimeDiagnostic({}, "v22.23.4")), ["nodeVersion", "deploymentSha"]);

const route = read("src/app/api/admin/runtime-diagnostic/route.ts");
assert.match(route, /requireAdmin/);
assert.match(route, /export async function GET/);
assert.doesNotMatch(route, /export async function POST/);
assert.doesNotMatch(route, /process\.env\.(STRIPE|SESSION|DATABASE)/);
assert.match(route, /runtime = "nodejs"/);
assert.match(read("src/lib/payments/flags.ts"), /envBool\("GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED", false\)/);

console.log("runtime-diagnostic: ok");
