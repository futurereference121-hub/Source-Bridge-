/**
 * Phase 1 Status repro against Production TEST via sign-in (no SESSION_SECRET needed).
 * Creates a temporary generic user, publishes Status, compares DB + surfaces.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.STATUS_PROBE_BASE || "https://www.sourcebridge.app";
const prisma = new PrismaClient();
const PASSWORD = `StatusQa!${randomBytes(4).toString("hex")}Aa1`;
const TAG = `status_qa_${Date.now().toString(36)}`;

function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plain, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

function calendarDayKey(date = new Date(), timeZone = process.env.APP_TIMEZONE || "UTC") {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* */
  }
  return date.toISOString().slice(0, 10);
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !cookie.includes("sb_session")) {
    throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return cookie;
}

async function api(cookie, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("cookie", cookie);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers, cache: "no-store" });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 400) };
  }
  return { res, data };
}

async function snapshotUser(userId) {
  const now = new Date();
  const dayKey = calendarDayKey(now);
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      slug: true,
      statuses: {
        orderBy: { postedAt: "desc" },
        take: 10,
        select: { id: true, text: true, postedAt: true, expiresAt: true },
      },
      rateLimitEvents: {
        where: { action: "status", dayKey },
        select: { id: true, createdAt: true, dayKey: true },
      },
    },
  });
  return {
    dayKey,
    dailyUsed: u?.rateLimitEvents.length ?? 0,
    statuses: (u?.statuses || []).map((s) => ({
      id: s.id,
      text: s.text,
      postedAt: s.postedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      active: s.expiresAt > now,
    })),
    activeCount: (u?.statuses || []).filter((s) => s.expiresAt > now).length,
  };
}

const email = `${TAG}@example.com`;
const username = TAG.slice(0, 24);
const slug = username;

const user = await prisma.user.create({
  data: {
    email,
    passwordHash: hashPassword(PASSWORD),
    emailVerified: true,
    onboardingComplete: true,
    name: "Status QA Generic",
    username,
    slug,
    isDiscoverable: true,
    isTestAccount: false,
    isAdmin: false,
    city: "Bangkok",
    country: "Thailand",
    memberType: "SOURCER",
    intent: "SOURCING",
    bio: "Generic Status QA user",
    publicDisplayMessage: "Status QA",
  },
});

console.log(
  JSON.stringify(
    {
      phase: "created",
      userId: user.id,
      username,
      slug,
      BASE,
      // password intentionally omitted from logs
    },
    null,
    2,
  ),
);

try {
  const cookie = await signIn(email);
  const before = await snapshotUser(user.id);
  const getBefore = await api(cookie, "/api/status");

  const text1 = `Status repro A ${Date.now().toString(36)}`;
  const post1 = await api(cookie, "/api/status", {
    method: "POST",
    body: JSON.stringify({
      text: text1,
      idempotencyKey: `k1_${Date.now()}`,
    }),
  });
  const dbAfter1 = await snapshotUser(user.id);
  const getAfter1 = await api(cookie, "/api/status");

  // double-submit same key+text immediately
  const postDup = await api(cookie, "/api/status", {
    method: "POST",
    body: JSON.stringify({
      text: text1,
      idempotencyKey: `k1_${Date.now()}`,
    }),
  });

  // different text within cooldown — expect 429
  const text2 = `Status repro B ${Date.now().toString(36)}`;
  const postCooldown = await api(cookie, "/api/status", {
    method: "POST",
    body: JSON.stringify({
      text: text2,
      idempotencyKey: `k2_${Date.now()}`,
    }),
  });

  const profileRes = await fetch(`${BASE}/members/${slug}`, {
    headers: { cookie },
    cache: "no-store",
  });
  const profileHtml = await profileRes.text();
  const feedRes = await api(cookie, "/api/feed?limit=20");
  const membersRes = await api(cookie, `/api/members?q=${encodeURIComponent(username)}&limit=5`);
  const member = (membersRes.data?.members || []).find((m) => m.username === username);

  const feedItems = feedRes.data?.items || [];
  const feedHit = feedItems.find(
    (i) => i.kind === "status" && (i.text === text1 || i.memberSlug === slug),
  );

  console.log(
    JSON.stringify(
      {
        phase: "results",
        before,
        getBefore: getBefore.data,
        post1: { status: post1.res.status, body: post1.data },
        dbAfter1,
        getAfter1: getAfter1.data,
        postDup: { status: postDup.res.status, body: postDup.data },
        postCooldown: { status: postCooldown.res.status, body: postCooldown.data },
        surfaces: {
          profileStatus: profileRes.status,
          textInProfile: profileHtml.includes(text1),
          profileSnippetHasStatus:
            profileHtml.includes(text1) || profileHtml.includes("No active status"),
          memberApiStatus: member?.status ?? null,
          feedHit: feedHit
            ? { id: feedHit.id, text: feedHit.text, postedAt: feedHit.postedAt }
            : null,
          divergence: {
            apiOk: post1.res.status === 200,
            dbActiveMatches:
              dbAfter1.statuses.find((s) => s.active)?.text === text1,
            getMatches: getAfter1.data?.status?.text === text1,
            profileMatches: profileHtml.includes(text1),
            feedMatches: Boolean(feedHit),
            memberCardStatus: member?.status?.text === text1 || member?.status === null,
          },
        },
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
  console.log(JSON.stringify({ phase: "cleanup", userId: user.id, username, cleanupOk }));
  await prisma.$disconnect();
  if (!cleanupOk) process.exitCode = 1;
}
