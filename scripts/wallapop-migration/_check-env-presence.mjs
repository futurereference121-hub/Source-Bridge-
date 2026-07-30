const sources = [
  [".env.local", process.env],
];

// Reload with dotenv-like manual parse of both files without printing secrets
import { readFileSync, existsSync } from "fs";

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const local = loadEnvFile(".env.local");
const base = loadEnvFile(".env");
const u = local.DATABASE_URL || base.DATABASE_URL || "";
console.log("DATABASE_URL:", u ? "present" : "missing");
console.log("length:", u.length);
console.log("contains_://:", u.includes("://"));
console.log("contains_postgres:", /postgres/i.test(u));
console.log("contains_prisma:", /prisma/i.test(u));
console.log("contains_neon:", /neon/i.test(u));
console.log("contains_supabase:", /supabase/i.test(u));
console.log("first_char_code:", u ? u.charCodeAt(0) : null);
console.log("looks_base64:", /^[A-Za-z0-9+/=_-]{20,}$/.test(u));
console.log("BLOB_READ_WRITE_TOKEN:", local.BLOB_READ_WRITE_TOKEN ? "present" : "missing");
console.log("BLOB_STORE_ID:", local.BLOB_STORE_ID ? "present" : "missing");

// Also check how node --env-file parses it
import { spawnSync } from "child_process";
const r = spawnSync(
  process.execPath,
  [
    "--env-file=.env.local",
    "-e",
    "const u=process.env.DATABASE_URL||''; console.log('node_len',u.length); console.log('node_has_scheme',u.includes('://')); console.log('node_has_postgres',/postgres/i.test(u));",
  ],
  { encoding: "utf8", cwd: process.cwd() },
);
console.log(r.stdout);
if (r.stderr) console.log("stderr", r.stderr.slice(0, 200));
