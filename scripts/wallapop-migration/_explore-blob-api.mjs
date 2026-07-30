import { spawnSync } from "child_process";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

function api(endpoint, extra = []) {
  const r = spawnSync(
    "npx",
    ["vercel", "api", endpoint, "--scope", "canna-cake", "--raw", ...extra],
    { encoding: "utf8", shell: true, cwd: root },
  );
  return {
    status: r.status,
    out: (r.stdout || "") + (r.stderr || ""),
  };
}

function redact(s) {
  return String(s)
    .replace(/vercel_blob_[A-Za-z0-9_.=+-]+/g, "[TOKEN]")
    .replace(/eyJ[A-Za-z0-9_.=+-]+/g, "[JWT]");
}

const storeId = "store_98LSuPpIO8LZsSit";
const projectId = "prj_QAn6QmUjVr49QVHHRDMfoNa3sFOf";

const attempts = [
  `/v1/storage/stores/${storeId}`,
  `/storage/stores/${storeId}`,
  `/storage/stores/blob/${storeId}`,
  `/v1/storage/stores/blob/${storeId}`,
  `/v9/projects/${projectId}`,
  `/v1/projects/${projectId}`,
];

for (const ep of attempts) {
  const r = api(ep);
  console.log("\n===", ep, "status", r.status);
  const red = redact(r.out);
  // Print only keys if JSON
  const idx = red.indexOf("{");
  if (idx >= 0) {
    try {
      const j = JSON.parse(red.slice(idx).replace(/\[TOKEN\]/g, '"TOKEN"').replace(/\[JWT\]/g, '"JWT"'));
      console.log("keys:", Object.keys(j).join(", "));
      if (j.token || j.rwToken || j.readWriteToken) console.log("HAS_TOKEN_FIELD");
      if (j.oidc) console.log("oidc:", JSON.stringify(j.oidc).slice(0, 300));
      if (j.env || j.environments) console.log("env fields present");
      // Look for blob-related nested keys
      const blobKeys = Object.keys(j).filter((k) => /blob|store|oidc|token/i.test(k));
      if (blobKeys.length) console.log("interesting:", blobKeys.join(", "));
    } catch {
      console.log(red.slice(0, 400));
    }
  } else {
    console.log(red.slice(0, 400));
  }
}

// Try minting OIDC with explicit production in query
const bodyFile = path.join(__dirname, "_oidc-body2.json");
writeFileSync(
  bodyFile,
  JSON.stringify({ environment: "production", iss: "https://oidc.vercel.com/canna-cake" }),
);
const mint = api(`/v1/projects/${projectId}/token`, ["-X", "POST", "--input", bodyFile]);
console.log("\n=== mint production attempt status", mint.status);
const midx = mint.out.indexOf("{");
if (midx >= 0) {
  try {
    const j = JSON.parse(mint.out.slice(midx));
    if (j.token) {
      const p = JSON.parse(
        Buffer.from(j.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
      );
      console.log("minted environment claim:", p.environment, "sub:", p.sub);
    } else {
      console.log(redact(mint.out).slice(0, 400));
    }
  } catch (e) {
    console.log(redact(mint.out).slice(0, 400));
  }
}
