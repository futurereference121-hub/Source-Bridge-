/**
 * End-to-end checks for password auth, discovery filtering, and deletion API shape.
 * Target: MESSAGING_E2E_URL or APP_URL (default https://www.sourcebridge.app after deploy).
 *
 * Run: node --env-file=.env scripts/test-accounts-e2e.mjs
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();
const base = (
  process.env.MESSAGING_E2E_URL ||
  process.env.APP_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

function assert(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  console.log(`OK   ${name}`);
}

function parseSetCookie(res) {
  const raw = res.headers.getSetCookie?.() || [];
  if (raw.length) return raw.map((c) => c.split(";")[0]).join("; ");
  const single = res.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

async function api(path, init = {}, cookie = "") {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data, cookie: parseSetCookie(res) || cookie };
}

const suffix = randomBytes(3).toString("hex");
const username = `e2e_user_${suffix}`;
const email = `e2e_user_${suffix}@sourcebridge.test`;
const weak = "password";
const strong = `Str0ngPass!${suffix}`;
const mismatch = "Str0ngPass!other";

try {
  console.log(`Target: ${base}`);

  const noPw = await api("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      name: "No Password",
      email: `nopw_${suffix}@sourcebridge.test`,
      intent: "both",
    }),
  });
  assert(
    "signup without password rejected",
    !noPw.res.ok && noPw.res.status >= 400,
  );

  const weakPw = await api("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      name: "Weak",
      email: `weak_${suffix}@sourcebridge.test`,
      username: `weak_${suffix}`,
      password: weak,
      confirmPassword: weak,
      intent: "both",
    }),
  });
  assert("weak password rejected", !weakPw.res.ok);

  const mismatchPw = await api("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      name: "Mismatch",
      email: `mis_${suffix}@sourcebridge.test`,
      username: `mis_${suffix}`,
      password: strong,
      confirmPassword: mismatch,
      intent: "both",
    }),
  });
  assert("mismatched passwords rejected", !mismatchPw.res.ok);

  const signup = await api("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      name: "E2E Tester",
      email,
      username,
      password: strong,
      confirmPassword: strong,
      intent: "both",
    }),
  });
  assert(
    "signup with password succeeds",
    signup.res.ok && Boolean(signup.data.account?.id),
  );
  assert("password hash never returned", signup.data.account?.passwordHash == null);
  assert(
    "hasPassword flag true",
    signup.data.account?.hasPassword === true,
  );

  const dbUser = await prisma.user.findUnique({ where: { email } });
  assert("password hashed in DB", Boolean(dbUser?.passwordHash?.includes(":")));
  assert("not discoverable until onboarded", dbUser?.onboardingComplete === false);

  const dupUser = await api("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      name: "Dup",
      email: `dup_${suffix}@sourcebridge.test`,
      username,
      password: strong,
      confirmPassword: strong,
      intent: "both",
    }),
  });
  assert("duplicate username rejected", dupUser.res.status === 409 || !dupUser.res.ok);

  const badLogin = await api("/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ identifier: email, password: "WrongPass1!" }),
  });
  assert("invalid credentials generic fail", !badLogin.res.ok);

  // Mark verified so login can proceed past check-email for API tests
  await prisma.user.update({
    where: { email },
    data: { emailVerified: true },
  });

  const loginEmail = await api("/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ identifier: email, password: strong }),
  });
  assert("login with email works", loginEmail.res.ok && Boolean(loginEmail.cookie));

  const loginUser = await api("/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ identifier: username, password: strong }),
  });
  assert("login with username works", loginUser.res.ok);

  // Complete onboarding fields for discoverability check (still not complete)
  const members = await api("/api/members");
  const listed = (members.data.members || members.data || []);
  const foundSelf = Array.isArray(listed)
    ? listed.some((m) => m.username === username || m.slug === username)
    : false;
  assert("incomplete profile not in Explore API", !foundSelf);

  const admin = await prisma.user.findFirst({
    where: { username: "adminsource" },
    select: { isDiscoverable: true, role: true, isAdmin: true },
  });
  assert("adminsource exists", Boolean(admin));
  assert("adminsource not discoverable", admin?.isDiscoverable === false);
  assert("adminsource is ADMIN", admin?.role === "ADMIN" || admin?.isAdmin);

  const messengers = await prisma.user.findMany({
    where: {
      OR: [
        { username: { in: ["messenger_a", "messenger_b", "messenger_c"] } },
        { email: { contains: "messenger-" } },
      ],
    },
    select: { username: true, isDiscoverable: true, isTestAccount: true, deletedAt: true },
  });
  for (const m of messengers) {
    assert(
      `messenger ${m.username || "?"} hidden`,
      m.isDiscoverable === false || m.isTestAccount === true || m.deletedAt != null,
    );
  }

  // Account deletion
  const delBad = await api(
    "/api/account/delete",
    {
      method: "POST",
      body: JSON.stringify({ password: strong, confirmText: "delete" }),
    },
    loginUser.cookie,
  );
  assert("deletion requires typed DELETE", !delBad.res.ok);

  const delWrong = await api(
    "/api/account/delete",
    {
      method: "POST",
      body: JSON.stringify({ password: "WrongPass1!", confirmText: "DELETE" }),
    },
    loginUser.cookie,
  );
  assert("deletion rejects wrong password", !delWrong.res.ok);

  const delOk = await api(
    "/api/account/delete",
    {
      method: "POST",
      body: JSON.stringify({ password: strong, confirmText: "DELETE" }),
    },
    loginUser.cookie,
  );
  assert("deletion succeeds", delOk.res.ok);

  const after = await prisma.user.findUnique({ where: { id: dbUser.id } });
  assert("user anonymized", after?.name === "Deleted user" && after?.deletedAt != null);
  assert("password cleared", after?.passwordHash == null);

  const relogin = await api("/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ identifier: email, password: strong }),
  });
  assert("deleted account cannot sign in", !relogin.res.ok);

  console.log("\nAccounts E2E passed.");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
