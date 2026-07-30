import { spawnSync } from "child_process";
import { appendFileSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const outPath = path.join(__dirname, "_oidc-out.json");

function redact(s) {
  return String(s || "")
    .replace(/vercel_blob_[A-Za-z0-9_.=+-]+/g, "[TOKEN_REDACTED]")
    .replace(/eyJ[A-Za-z0-9_.=+-]+/g, "[JWT_REDACTED]");
}

function runApi(args) {
  return spawnSync("npx", ["vercel", "api", ...args, "--scope", "canna-cake"], {
    encoding: "utf8",
    shell: true,
    cwd: root,
  });
}

// Try generating a production-scoped project OIDC token.
const body = {
  // Common field names used by Vercel OIDC APIs; API may ignore unknowns.
  environment: "production",
  target: "production",
};

const bodyFile = path.join(__dirname, "_oidc-body.json");
writeFileSync(bodyFile, JSON.stringify(body));

const r = runApi([
  "/v1/projects/source-bridge/token",
  "-X",
  "POST",
  "--input",
  bodyFile,
  "--raw",
]);

writeFileSync(outPath, r.stdout || r.stderr || "");
console.log("status", r.status);
console.log(redact(r.stdout || "").slice(0, 400));
if (r.status !== 0) {
  console.log("stderr:", redact(r.stderr || "").slice(0, 800));
}

const raw = r.stdout || "";
const jsonStart = raw.indexOf("{");
if (jsonStart >= 0) {
  try {
    const payload = JSON.parse(raw.slice(jsonStart));
    const token =
      payload.token ||
      payload.oidcToken ||
      payload.idToken ||
      payload.VERCEL_OIDC_TOKEN;
    console.log("token_field_present:", Boolean(token));
    if (token) {
      // Append/update .env.local without printing the value.
      const envPath = path.join(root, ".env.local");
      let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
      if (/^VERCEL_OIDC_TOKEN=/m.test(env)) {
        env = env.replace(/^VERCEL_OIDC_TOKEN=.*$/m, `VERCEL_OIDC_TOKEN="${token}"`);
      } else {
        env += `\nVERCEL_OIDC_TOKEN="${token}"\n`;
      }
      writeFileSync(envPath, env);
      console.log("wrote_oidc_to_env_local: yes");
    }
  } catch (err) {
    console.log("parse_error:", err.message);
  }
}
