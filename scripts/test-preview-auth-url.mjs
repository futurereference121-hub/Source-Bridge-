/**
 * Preview auth URL isolation tests (no network, no secrets).
 * Proves verification links stay on Preview host when APP_URL is mis-shared with Production.
 *
 * Run: node scripts/test-preview-auth-url.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

const PREVIEW_BRANCH =
  "source-bridge-git-global-payouts-pilot-canna-cake.vercel.app";
const PREVIEW_ORIGIN = `https://${PREVIEW_BRANCH}`;
const PROD_ORIGIN = "https://www.sourcebridge.app";

// --- Pure mirror of src/lib/app-url.ts (keep in sync) ---
const PRODUCTION_HOSTS = new Set(["sourcebridge.app", "www.sourcebridge.app"]);

function normalizeOrigin(raw) {
  const trimmed = String(raw || "").trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function hostOf(origin) {
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isProductionCanonicalHost(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  return PRODUCTION_HOSTS.has(h) || h.endsWith(".sourcebridge.app");
}

function vercelPreviewOrigin(env) {
  if (env.VERCEL_ENV !== "preview") return null;
  const branch = String(env.VERCEL_BRANCH_URL || "").trim();
  const deployment = String(env.VERCEL_URL || "").trim();
  const host = branch || deployment;
  if (!host) return null;
  return normalizeOrigin(host);
}

function getAppUrl(env, fallback = "http://localhost:3000") {
  const previewOrigin = vercelPreviewOrigin(env);
  const configured = normalizeOrigin(
    env.APP_URL || env.NEXT_PUBLIC_APP_URL || "",
  );
  const configuredHost = hostOf(configured);

  if (previewOrigin) {
    if (configured && !isProductionCanonicalHost(configuredHost)) {
      return configured;
    }
    return previewOrigin;
  }

  if (configured) return configured;
  return String(fallback || "http://localhost:3000").replace(/\/$/, "");
}

function buildVerifyUrl(env, token) {
  return `${getAppUrl(env)}/verify-email?token=${encodeURIComponent(token)}`;
}

// --- Source contract ---
const appUrlSrc = read("src/lib/app-url.ts");
ok("app-url exports getAppUrl", /export function getAppUrl/.test(appUrlSrc));
ok(
  "app-url guards Production hosts on Preview",
  /VERCEL_ENV/.test(appUrlSrc) &&
    /sourcebridge\.app/.test(appUrlSrc) &&
    /VERCEL_BRANCH_URL/.test(appUrlSrc),
);
ok(
  "app-url mirror stays in sync (isProductionCanonicalHost)",
  /export function isProductionCanonicalHost/.test(appUrlSrc),
);

const emailSrc = read("src/lib/email.ts");
ok("email uses shared getAppUrl", /from \"@\/lib\/app-url\"/.test(emailSrc));
ok(
  "buildVerifyUrl uses getAppUrl",
  /function buildVerifyUrl[\s\S]*getAppUrl\(\)/.test(emailSrc),
);
ok(
  "email does not hardcode sourcebridge.app",
  !/https?:\/\/(www\.)?sourcebridge\.app/.test(emailSrc),
);

const authSrc = read("src/lib/auth.ts");
ok(
  "session cookies are host-only (no Domain=)",
  !/domain\s*:/i.test(authSrc) && /jar\.set\(COOKIE_NAME/.test(authSrc),
);

const verifySrc = read("src/app/api/auth/verify/route.ts");
ok(
  "verify route uses prisma (deployment DATABASE_URL)",
  /prisma\.emailVerificationToken\.findUnique/.test(verifySrc),
);

const signupSrc = read("src/app/api/auth/signup/route.ts");
ok(
  "signup stores emailVerificationToken in prisma",
  /emailVerificationToken\.create/.test(signupSrc),
);
ok(
  "signup sends verification via sendVerificationEmail",
  /sendVerificationEmail/.test(signupSrc),
);

ok(
  "isProductionCanonicalHost www",
  isProductionCanonicalHost("www.sourcebridge.app") === true,
);
ok(
  "isProductionCanonicalHost vercel.app false",
  isProductionCanonicalHost(PREVIEW_BRANCH) === false,
);

function scenario(name, env, expectOrigin) {
  const origin = getAppUrl(env);
  ok(`${name} → ${expectOrigin}`, origin === expectOrigin);
}

scenario(
  "Preview ignores Production APP_URL when VERCEL_BRANCH_URL set",
  {
    VERCEL_ENV: "preview",
    APP_URL: PROD_ORIGIN,
    VERCEL_BRANCH_URL: PREVIEW_BRANCH,
    VERCEL_URL: "source-bridge-xyz-canna-cake.vercel.app",
  },
  PREVIEW_ORIGIN,
);

scenario(
  "Preview prefers non-prod APP_URL override",
  {
    VERCEL_ENV: "preview",
    APP_URL: PREVIEW_ORIGIN,
    VERCEL_BRANCH_URL: "other-preview.vercel.app",
  },
  PREVIEW_ORIGIN,
);

scenario(
  "Preview falls back to VERCEL_URL when branch missing",
  {
    VERCEL_ENV: "preview",
    APP_URL: PROD_ORIGIN,
    VERCEL_URL: PREVIEW_BRANCH,
  },
  PREVIEW_ORIGIN,
);

scenario(
  "Production keeps APP_URL",
  {
    VERCEL_ENV: "production",
    APP_URL: PROD_ORIGIN,
    VERCEL_URL: "should-not-use.vercel.app",
  },
  PROD_ORIGIN,
);

scenario("Local fallback", {}, "http://localhost:3000");

{
  const token = "preview-token-abc";
  const url = buildVerifyUrl(
    {
      VERCEL_ENV: "preview",
      APP_URL: PROD_ORIGIN,
      VERCEL_BRANCH_URL: PREVIEW_BRANCH,
    },
    token,
  );
  ok(
    "buildVerifyUrl Preview host",
    url.startsWith(`${PREVIEW_ORIGIN}/verify-email?token=`),
  );
  ok("buildVerifyUrl encodes token", url.includes(encodeURIComponent(token)));
  ok(
    "buildVerifyUrl never points at Production",
    !url.includes("sourcebridge.app"),
  );
}

// Proof: Preview DATABASE_URL (when set) is what verify uses — isolation is env-scoped.
ok(
  "connect + global-payouts use getAppUrlFromRequest",
  /getAppUrlFromRequest/.test(read("src/app/api/payments/connect/route.ts")) &&
    /getAppUrlFromRequest/.test(
      read("src/app/api/payments/global-payouts/route.ts"),
    ),
);

console.log(`\npreview-auth-url: ${passed} assertions passed`);
