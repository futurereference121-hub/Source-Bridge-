/**
 * Post-deploy Status observe on Production TEST (eligible generic user).
 */
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const BASE = "https://www.sourcebridge.app";
const prisma = new PrismaClient();
const PASSWORD = `StatusQa!${randomBytes(4).toString("hex")}Aa1`;
const TAG = `status_live_${Date.now().toString(36)}`;

function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plain, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

async function signIn(identifier) {
  const res = await fetch(`${BASE}/api/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const raw = setCookie.length
    ? setCookie
    : [res.headers.get("set-cookie")].filter(Boolean);
  const cookie = raw
    .map((c) => String(c).split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!res.ok || !cookie.includes("sb_session")) {
    throw new Error(`sign-in failed ${res.status}`);
  }
  return cookie;
}

async function api(cookie, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("cookie", cookie);
  if (init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`${BASE}${path}`, { ...init, headers, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

const email = `${TAG}@example.com`;
const username = TAG.slice(0, 24);
const user = await prisma.user.create({
  data: {
    email,
    passwordHash: hashPassword(PASSWORD),
    emailVerified: true,
    onboardingComplete: true,
    name: "Status Live Observe",
    username,
    slug: username,
    isDiscoverable: true,
    isTestAccount: false,
    city: "Bangkok",
    country: "Thailand",
    bio: "live observe",
    publicDisplayMessage: "live observe",
  },
});

try {
  const cookie = await signIn(email);
  const text = `Live Status observe ${Date.now().toString(36)}`;
  const before = await api(cookie, "/api/status");
  const post = await api(cookie, "/api/status", {
    method: "POST",
    body: JSON.stringify({ text, idempotencyKey: `live_${Date.now()}` }),
  });
  const after = await api(cookie, "/api/status");
  const dup = await api(cookie, "/api/status", {
    method: "POST",
    body: JSON.stringify({ text, idempotencyKey: `live_${Date.now()}` }),
  });
  const profileHtml = await (
    await fetch(`${BASE}/members/${username}`, { headers: { cookie }, cache: "no-store" })
  ).text();
  const feed = await api(cookie, "/api/feed?limit=20");
  const members = await api(cookie, `/api/members?q=${encodeURIComponent(username)}&limit=5`);
  const member = (members.data.members || []).find((m) => m.username === username);
  const feedHit = (feed.data.items || []).find((i) => i.text === text);

  const db = await prisma.statusUpdate.findMany({
    where: { userId: user.id },
    orderBy: { postedAt: "desc" },
    take: 3,
  });

  console.log(
    JSON.stringify(
      {
        username,
        postStatus: post.res.status,
        postBody: post.data,
        dupStatus: dup.res.status,
        dupExisting: dup.data.existing,
        dupCode: dup.data.code,
        getAfterText: after.data.status?.text,
        dbActive: db.filter((s) => s.expiresAt > new Date()).map((s) => s.text),
        profileHasText: profileHtml.includes(text),
        feedHasText: Boolean(feedHit),
        memberCardStatus: member?.status?.text || null,
        cooldownOnSecondDifferent: null,
        beforeRemaining: before.data.limit?.remaining,
        afterRemaining: after.data.limit?.remaining,
        observedUpdate:
          post.res.status === 200 &&
          after.data.status?.text === text &&
          profileHtml.includes(text) &&
          Boolean(feedHit),
      },
      null,
      2,
    ),
  );
} finally {
  let cleanupOk = false;
  try {
    await prisma.rateLimitEvent.deleteMany({ where: { userId: user.id } });
    await prisma.statusUpdate.deleteMany({ where: { userId: user.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.notification
      .deleteMany({
        where: { OR: [{ userId: user.id }, { actorId: user.id }] },
      })
      .catch(() => null);
    await prisma.follow
      .deleteMany({
        where: {
          OR: [{ followerId: user.id }, { followingId: user.id }],
        },
      })
      .catch(() => null);
    await prisma.user.delete({ where: { id: user.id } });
    const gone = await prisma.user.findUnique({ where: { id: user.id } });
    cleanupOk = !gone;
  } catch (cleanupErr) {
    console.error("CLEANUP_FAILED", cleanupErr);
  }
  console.log(JSON.stringify({ cleaned: cleanupOk, userId: user.id, username }));
  await prisma.$disconnect();
  if (!cleanupOk) process.exitCode = 1;
}
