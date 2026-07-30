import { writeFileSync, unlinkSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const tmpFile = path.join(__dirname, "_blob-probe-temp.txt");
const pathname = `stock/_migration-probe/probe-${Date.now()}.txt`;

writeFileSync(tmpFile, "source-bridge wallapop migration blob probe\n");

function run(args) {
  return spawnSync("npx", ["vercel", "blob", ...args], {
    encoding: "utf8",
    shell: true,
    cwd: root,
  });
}

function redact(s) {
  return String(s || "")
    .replace(/https?:\/\/\S+/g, "[URL_REDACTED]")
    .replace(/vercel_blob_[A-Za-z0-9_]+/g, "[TOKEN_REDACTED]");
}

const put = run([
  "put",
  tmpFile,
  "--pathname",
  pathname,
  "--content-type",
  "text/plain",
  "--access",
  "public",
]);

if (put.status !== 0) {
  console.error("upload: failed");
  console.error(redact(put.stderr || put.stdout).slice(0, 800));
  process.exit(1);
}

const putOut = put.stdout || "";
const urlMatch = putOut.match(/https:\/\/\S+/);
if (!urlMatch) {
  console.error("upload: could not find URL in CLI output");
  console.error(redact(putOut).slice(0, 800));
  process.exit(1);
}
const url = urlMatch[0].replace(/[>\])},]+$/g, "");
console.log("upload: ok");
console.log("pathname:", pathname);

const del = run(["del", url]);
if (del.status !== 0) {
  console.error("delete: failed");
  console.error(redact(del.stderr || del.stdout).slice(0, 800));
  process.exit(1);
}
console.log("delete: ok");

if (existsSync(tmpFile)) unlinkSync(tmpFile);
console.log("orphan_check: local temp removed; remote delete requested");
console.log("blob_connectivity: PASS");
