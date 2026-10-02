/**
 * Password-setup recovery for unverified accounts. No database and no email delivery.
 * Run: npx tsx scripts/test-password-setup-recovery.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fulfillPasswordSetupRequest } from "../src/lib/auth/password-setup-request.ts";
import { verificationTokenRejection } from "../src/lib/auth/verification-token.ts";
import { previewMailReadiness } from "../src/lib/auth/preview-mail-readiness.ts";
import { canAttemptIp, clearIpAttempts, recordIpAttempt } from "../src/lib/rate-limit.ts";

const NOW = Date.parse("2026-10-02T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

let passed = 0;
function ok(name: string) {
  passed += 1;
  console.log(`PASS ${name}`);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  passwordHash: string | null;
  deletedAt: Date | null;
  onboardingComplete: boolean;
};

function harness(user: User | null) {
  const snapshot = user ? { ...user } : null;
  const verificationTokens: Array<{ userId: string; tokenHash: string; email: string; expiresAt: Date }> = [];
  const passwordTokens: Array<{ userId: string; tokenHash: string; expiresAt: Date }> = [];
  const verificationMails: Array<{ to: string; name: string; token: string }> = [];
  const passwordMails: Array<{ to: string; subject: string; verifyUrl: string }> = [];
  let verificationFails = false;
  let passwordFails = false;
  const deps = {
    findUser: async () => (snapshot ? { ...snapshot } : null),
    createVerificationToken: async (data: (typeof verificationTokens)[number]) => {
      verificationTokens.push(data);
    },
    sendVerificationEmail: async (opts: (typeof verificationMails)[number]) => {
      if (verificationFails) throw new Error("mail down");
      verificationMails.push(opts);
      return { ok: true, previewUrl: null as string | null };
    },
    createPasswordResetToken: async (data: (typeof passwordTokens)[number]) => {
      passwordTokens.push(data);
    },
    sendPasswordEmail: async (input: { to: string; subject: string; verifyUrl: string; text: string; html: string }) => {
      if (passwordFails) return { ok: false, previewUrl: null as string | null };
      passwordMails.push(input);
      return { ok: true, previewUrl: null as string | null };
    },
    createRawToken: () => "raw-token-secret",
    hashToken,
    buildSetPasswordUrl: (token: string) => `https://preview.example/set-password?token=${token}`,
    now: () => NOW,
  };
  return {
    deps,
    snapshot,
    verificationTokens,
    passwordTokens,
    verificationMails,
    passwordMails,
    failVerification() {
      verificationFails = true;
    },
    failPassword() {
      passwordFails = true;
    },
  };
}

const unverified: User = {
  id: "user-a",
  name: "Alex",
  email: "alex@example.com",
  emailVerified: false,
  passwordHash: null,
  deletedAt: null,
  onboardingComplete: false,
};

async function main() {
{
  const h = harness(unverified);
  const result = await fulfillPasswordSetupRequest("alex@example.com", h.deps);
  assert.equal(result.previewUrl, null);
  assert.equal(h.verificationMails.length, 1);
  assert.equal(h.verificationMails[0].to, "alex@example.com");
  assert.equal(h.verificationMails[0].token, "raw-token-secret");
  assert.equal(h.passwordMails.length, 0);
  assert.equal(h.passwordTokens.length, 0);
  assert.equal(h.verificationTokens.length, 1);
  assert.equal(h.verificationTokens[0].tokenHash, hashToken("raw-token-secret"));
  assert.notEqual(h.verificationTokens[0].tokenHash, "raw-token-secret");
  assert.equal(h.verificationTokens[0].email, "alex@example.com");
  assert.equal(h.verificationTokens[0].expiresAt.getTime(), NOW + DAY);
  assert.deepEqual(h.snapshot, unverified);
  ok("unverified account receives a verification request without access");
}

{
  const verified: User = { ...unverified, emailVerified: true, passwordHash: "stored-hash" };
  const h = harness(verified);
  const result = await fulfillPasswordSetupRequest("alex@example.com", h.deps);
  assert.equal(result.previewUrl, null);
  assert.equal(h.verificationMails.length, 0);
  assert.equal(h.verificationTokens.length, 0);
  assert.equal(h.passwordTokens.length, 1);
  assert.equal(h.passwordTokens[0].tokenHash, hashToken("raw-token-secret"));
  assert.equal(h.passwordTokens[0].expiresAt.getTime(), NOW + HOUR);
  assert.equal(h.passwordMails.length, 1);
  assert.equal(h.passwordMails[0].subject, "Reset your Source Bridge password");
  assert.match(h.passwordMails[0].verifyUrl, /\/set-password\?token=/);
  assert.equal(h.snapshot?.emailVerified, true);
  assert.equal(h.snapshot?.passwordHash, "stored-hash");
  ok("verified account keeps the password-setup flow");
}

{
  const missing = harness(null);
  const deleted = harness({ ...unverified, deletedAt: new Date(NOW) });
  const present = harness(unverified);
  const a = await fulfillPasswordSetupRequest("nobody@example.com", missing.deps);
  const b = await fulfillPasswordSetupRequest("alex@example.com", deleted.deps);
  const c = await fulfillPasswordSetupRequest("alex@example.com", present.deps);
  assert.deepEqual(a, { previewUrl: null });
  assert.deepEqual(b, { previewUrl: null });
  assert.deepEqual(c, { previewUrl: null });
  assert.equal(missing.verificationMails.length + deleted.verificationMails.length, 0);
  assert.equal(missing.passwordMails.length + deleted.passwordMails.length, 0);
  ok("unknown and deleted addresses stay on the generic empty response");
}

{
  const now = NOW;
  assert.deepEqual(verificationTokenRejection(null, now), { error: "Invalid verification link" });
  const expired = verificationTokenRejection(
    { usedAt: null, expiresAt: new Date(now - 1) },
    now,
  );
  assert.equal(expired?.code, "TOKEN_EXPIRED");
  const used = verificationTokenRejection(
    { usedAt: new Date(now - 10), expiresAt: new Date(now + DAY) },
    now,
  );
  assert.equal(used?.code, "TOKEN_USED");
  assert.equal(
    verificationTokenRejection({ usedAt: null, expiresAt: new Date(now + DAY) }, now),
    null,
  );
  ok("expired, used, and unknown verification tokens are rejected");
}

{
  const h = harness(unverified);
  h.failVerification();
  await assert.rejects(() => fulfillPasswordSetupRequest("alex@example.com", h.deps));
  assert.equal(h.verificationTokens.length, 1);
  assert.equal(h.snapshot?.emailVerified, false);
  assert.equal(h.snapshot?.passwordHash, null);
  const password = harness({ ...unverified, emailVerified: true, passwordHash: null });
  password.failPassword();
  const result = await fulfillPasswordSetupRequest("alex@example.com", password.deps);
  assert.deepEqual(result, { previewUrl: null });
  assert.equal(password.snapshot?.emailVerified, true);
  assert.equal(password.snapshot?.passwordHash, null);
  ok("email failure does not grant access");
}

{
  const key = `password-setup-recovery-${process.pid}`;
  clearIpAttempts(key);
  for (let i = 0; i < 8; i += 1) {
    assert.equal(canAttemptIp(key, { maxAttempts: 8 }), true);
    recordIpAttempt(key);
  }
  assert.equal(canAttemptIp(key, { maxAttempts: 8 }), false);
  clearIpAttempts(key);
  ok("password-setup rate limit still stops the ninth attempt");
}

{
  const route = readFileSync(new URL("../src/app/api/auth/request-set-password/route.ts", import.meta.url), "utf8");
  const verify = readFileSync(new URL("../src/app/api/auth/verify/route.ts", import.meta.url), "utf8");
  const signIn = readFileSync(new URL("../src/app/api/auth/sign-in/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/app/set-password/page.tsx", import.meta.url), "utf8");
  const e2e = readFileSync(new URL("../src/app/api/diagnostics/gp-preview-runtime/e2e/route.ts", import.meta.url), "utf8");
  const restore = readFileSync(new URL("../src/app/api/diagnostics/gp-preview-runtime/restore/route.ts", import.meta.url), "utf8");
  assert.match(route, /sendVerificationEmail/);
  assert.match(route, /canAttemptIp\(ip, \{ maxAttempts: 8 \}\)/);
  assert.match(route, /return Response\.json\(\{ ok: true \}\)/);
  assert.doesNotMatch(route, /createSession/);
  assert.doesNotMatch(route, /data:\s*\{[^}]*emailVerified/);
  assert.match(verify, /verificationTokenRejection\(record\)/);
  const rejectionAt = verify.indexOf("verificationTokenRejection(record)");
  const verifyWriteAt = verify.indexOf("emailVerified: true");
  assert.ok(rejectionAt >= 0 && verifyWriteAt > rejectionAt);
  assert.match(signIn, /NEED_PASSWORD/);
  assert.ok(signIn.indexOf("NEED_PASSWORD") < signIn.indexOf("createSession(user.id)"));
  assert.match(page, /Send link/);
  assert.doesNotMatch(page, /its email is verified/);
  assert.match(e2e, /status:\s*410/);
  assert.match(restore, /status:\s*410/);
  ok("route, sign-in, and disabled mutation guards stay in place");
}

{
  const previous = {
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    APP_URL: process.env.APP_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
  };
  process.env.EMAIL_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "re_example";
  process.env.EMAIL_FROM = "Source Bridge <mail@example.com>";
  process.env.APP_URL = "https://source-bridge-git-global-payouts-pilot-canna-cake.vercel.app";
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_BRANCH_URL = "source-bridge-git-global-payouts-pilot-canna-cake.vercel.app";
  const ready = previewMailReadiness();
  assert.equal(ready.provider, "resend");
  assert.equal(ready.credentials_present, true);
  assert.equal(ready.delivery_supported, true);
  assert.equal(ready.link_origin_is_pilot, true);
  assert.equal(ready.link_path, "/verify-email");
  assert.equal(JSON.stringify(ready).includes("re_example"), false);
  assert.equal(JSON.stringify(ready).includes("mail@example.com"), false);
  process.env.APP_URL = "https://www.sourcebridge.app";
  const production = previewMailReadiness();
  assert.equal(production.production_origin, false);
  assert.equal(production.link_origin_is_pilot, true);
  for (const [key, value] of Object.entries(previous)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  ok("mail readiness reports delivery without credential values");
}

console.log(`password-setup-recovery ${passed} passed`);
}

main();
