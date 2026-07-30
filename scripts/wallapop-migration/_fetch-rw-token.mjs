import { spawnSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const storeId = "store_98LSuPpIO8LZsSit";
const sts = "sts_OuYI4RLR7rt4ZHxC";
const connectionId = "spc_XpqOgCA1CngvHBnV";

function api(endpoint, extra = []) {
  const r = spawnSync(
    "npx",
    ["vercel", "api", endpoint, "--scope", "canna-cake", "--raw", ...extra],
    { encoding: "utf8", shell: true, cwd: root, maxBuffer: 10 * 1024 * 1024 },
  );
  return { status: r.status, out: ((r.stdout || "") + "\n" + (r.stderr || "")).trim() };
}

function redact(s) {
  return String(s)
    .replace(/vercel_blob_[A-Za-z0-9_.=+-]+/g, "[TOKEN]")
    .replace(/eyJ[A-Za-z0-9_.=+-]+/g, "[JWT]");
}

const endpoints = [
  `/v1/storage/token-sets/${sts}`,
  `/v1/storage/stores/${storeId}/token-sets/${sts}`,
  `/v1/storage/stores/${storeId}/tokens`,
  `/v1/storage/stores/${storeId}/credentials`,
  `/v1/storage/stores/${storeId}/connections/${connectionId}`,
  `/v1/storage/stores/${storeId}/connections/${connectionId}/token`,
  `/v1/storage/stores/${storeId}/connections/${connectionId}/tokens`,
];

for (const ep of endpoints) {
  const r = api(ep);
  console.log(`\nGET ${ep} => ${r.status}`);
  console.log(redact(r.out).slice(0, 400));
}

// Try creating a new RW token for the store
const body = path.join(__dirname, "_token-body.json");
writeFileSync(body, JSON.stringify({ name: "wallapop-migration-temp", role: "read-write" }));
for (const ep of [
  `/v1/storage/stores/${storeId}/tokens`,
  `/v1/storage/token-sets/${sts}/tokens`,
]) {
  const r = api(ep, ["-X", "POST", "--input", body]);
  console.log(`\nPOST ${ep} => ${r.status}`);
  console.log(redact(r.out).slice(0, 500));
  const m = r.out.match(/vercel_blob_[A-Za-z0-9_.=+-]+/);
  if (m) {
    const token = m[0];
    const envPath = path.join(root, ".env.local");
    let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    if (/^BLOB_READ_WRITE_TOKEN=/m.test(env)) {
      env = env.replace(/^BLOB_READ_WRITE_TOKEN=.*$/m, `BLOB_READ_WRITE_TOKEN="${token}"`);
    } else {
      env += `\nBLOB_READ_WRITE_TOKEN="${token}"\n`;
    }
    writeFileSync(envPath, env);
    console.log("BLOB_READ_WRITE_TOKEN: present (written to .env.local)");
  }
}
