import { spawnSync } from "child_process";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const storeId = "store_98LSuPpIO8LZsSit";
const projectId = "prj_QAn6QmUjVr49QVHHRDMfoNa3sFOf";
const connectionId = "spc_XpqOgCA1CngvHBnV";

function api(endpoint, extra = []) {
  const r = spawnSync(
    "npx",
    ["vercel", "api", endpoint, "--scope", "canna-cake", "--raw", ...extra],
    { encoding: "utf8", shell: true, cwd: root, maxBuffer: 10 * 1024 * 1024 },
  );
  const out = (r.stdout || "").trim();
  const err = (r.stderr || "").trim();
  // Prefer stdout JSON when present
  return { status: r.status, out: out || err };
}

function parseJson(text) {
  const idx = text.indexOf("{");
  if (idx < 0) return null;
  // Take from first { to last }
  const last = text.lastIndexOf("}");
  return JSON.parse(text.slice(idx, last + 1));
}

function redact(s) {
  return String(s)
    .replace(/vercel_blob_[A-Za-z0-9_.=+-]+/g, "[TOKEN]")
    .replace(/eyJ[A-Za-z0-9_.=+-]+/g, "[JWT]");
}

// 1) Connect development environment only
const body1 = path.join(__dirname, "_patch-body.json");
writeFileSync(
  body1,
  JSON.stringify({
    projectId,
    environments: ["development"],
  }),
);
const connectDev = api(`/v1/storage/stores/${storeId}/connections`, [
  "-X",
  "POST",
  "--input",
  body1,
]);
console.log("connect development-only status", connectDev.status);
console.log(redact(connectDev.out).slice(0, 600));

// 2) Patch existing connection to include development
writeFileSync(
  body1,
  JSON.stringify({
    environments: ["production", "preview", "development"],
  }),
);
const patch = api(
  `/v1/storage/stores/${storeId}/connections/${connectionId}`,
  ["-X", "PATCH", "--input", body1],
);
console.log("\npatch connection status", patch.status);
console.log(redact(patch.out).slice(0, 600));

// 3) Read back environments
const store = api(`/v1/storage/stores/${storeId}`);
const j = parseJson(store.out);
const meta = j?.store?.projectsMetadata || [];
console.log(
  "\nenvironments now:",
  JSON.stringify(meta.map((m) => ({ id: m.id, environments: m.environments }))),
);
