import { spawnSync } from "child_process";
import { writeFileSync, readFileSync, appendFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const storeId = "store_98LSuPpIO8LZsSit";
const projectId = "prj_QAn6QmUjVr49QVHHRDMfoNa3sFOf";

function api(endpoint, extra = []) {
  const r = spawnSync(
    "npx",
    ["vercel", "api", endpoint, "--scope", "canna-cake", "--raw", ...extra],
    { encoding: "utf8", shell: true, cwd: root, maxBuffer: 10 * 1024 * 1024 },
  );
  return { status: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function findInteresting(obj, pathPrefix = "", hits = []) {
  if (!obj || typeof obj !== "object") return hits;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => findInteresting(v, `${pathPrefix}[${i}]`, hits));
    return hits;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = pathPrefix ? `${pathPrefix}.${k}` : k;
    if (/token|secret|password|oidc|rwToken|readWrite/i.test(k)) {
      hits.push({
        path: p,
        type: typeof v,
        present: v != null && String(v).length > 0,
        length: typeof v === "string" ? v.length : undefined,
        previewType:
          typeof v === "string" && v.startsWith("vercel_blob_")
            ? "vercel_blob_token"
            : typeof v === "string" && v.startsWith("eyJ")
              ? "jwt"
              : typeof v,
      });
    }
    if (v && typeof v === "object") findInteresting(v, p, hits);
  }
  return hits;
}

const storeRes = api(`/v1/storage/stores/${storeId}`);
writeFileSync(path.join(__dirname, "_store-raw.json"), storeRes.out);
const storeJson = JSON.parse(storeRes.out.slice(storeRes.out.indexOf("{")));
const hits = findInteresting(storeJson);
console.log("store_interesting_fields:");
console.log(JSON.stringify(hits, null, 2));

const meta = storeJson.store?.projectsMetadata || [];
console.log(
  "projectsMetadata:",
  JSON.stringify(
    meta.map((m) => ({
      projectId: m.projectId,
      name: m.name,
      environments: m.environments,
      envId: m.envId,
      id: m.id,
    })),
    null,
    2,
  ),
);

// Look for a token field we can use as BLOB_READ_WRITE_TOKEN without printing it
const tokenHit = hits.find((h) => h.previewType === "vercel_blob_token");
if (tokenHit) {
  // resolve value
  const parts = tokenHit.path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur = storeJson;
  for (const part of parts) cur = cur?.[part];
  if (typeof cur === "string" && cur.startsWith("vercel_blob_")) {
    const envPath = path.join(root, ".env.local");
    let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    if (/^BLOB_READ_WRITE_TOKEN=/m.test(env)) {
      env = env.replace(/^BLOB_READ_WRITE_TOKEN=.*$/m, `BLOB_READ_WRITE_TOKEN="${cur}"`);
    } else {
      env += `\nBLOB_READ_WRITE_TOKEN="${cur}"\n`;
    }
    writeFileSync(envPath, env);
    console.log("BLOB_READ_WRITE_TOKEN: present (written to .env.local from store metadata)");
  }
} else {
  console.log("BLOB_READ_WRITE_TOKEN: missing from store metadata");
}

// Try patching project connection environments to include development
const conn = meta.find((m) => m.projectId === projectId);
if (conn?.id) {
  console.log("connection id:", conn.id, "envs:", conn.environments);
}
