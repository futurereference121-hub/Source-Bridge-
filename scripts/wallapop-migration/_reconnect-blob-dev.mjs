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
  return {
    status: r.status,
    out: ((r.stdout || "") + "\n" + (r.stderr || "")).trim(),
  };
}

function parseJson(text) {
  const idx = text.indexOf("{");
  if (idx < 0) return null;
  const last = text.lastIndexOf("}");
  try {
    return JSON.parse(text.slice(idx, last + 1));
  } catch {
    return null;
  }
}

function redact(s) {
  return String(s)
    .replace(/vercel_blob_[A-Za-z0-9_.=+-]+/g, "[TOKEN]")
    .replace(/eyJ[A-Za-z0-9_.=+-]+/g, "[JWT]");
}

function envsNow() {
  const store = api(`/v1/storage/stores/${storeId}`);
  const j = parseJson(store.out);
  return (j?.store?.projectsMetadata || []).map((m) => ({
    id: m.id,
    projectId: m.projectId,
    environments: m.environments,
  }));
}

console.log("before:", JSON.stringify(envsNow()));

// Delete existing connection (will recreate immediately with development included)
const del = api(`/v1/storage/stores/${storeId}/connections/${connectionId}`, [
  "-X",
  "DELETE",
  "--dangerously-skip-permissions",
]);
console.log("\ndelete status", del.status);
console.log(redact(del.out).slice(0, 400));
console.log("after delete:", JSON.stringify(envsNow()));

const bodyFile = path.join(__dirname, "_patch-body.json");
writeFileSync(
  bodyFile,
  JSON.stringify({
    projectId,
    environments: ["production", "preview", "development"],
  }),
);

const create = api(`/v1/storage/stores/${storeId}/connections`, [
  "-X",
  "POST",
  "--input",
  bodyFile,
]);
console.log("\ncreate status", create.status);
console.log(redact(create.out).slice(0, 700));
console.log("after create:", JSON.stringify(envsNow()));
