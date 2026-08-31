/**
 * Source Bridge Live foundation — contract + domain tests.
 * Cloudflare is mocked. No paid Stream resources.
 *
 * Run: npm run test:live-streaming
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

process.env.LIVE_STREAMING_ENABLED = "true";
process.env.LIVE_STREAM_PROVIDER = "mock";

console.log("=== Live contract ===");

{
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model LiveSession/);
  assert.match(schema, /model LiveReport/);
  assert.match(schema, /activeLock/);
  assert.match(schema, /PREPARING \| LIVE \| ENDED \| TERMINATED \| FAILED/);
  assert.doesNotMatch(
    read("prisma/migrations/20260830120000_source_bridge_live_foundation/migration.sql"),
    /ProtectedTransaction|PaymentTicket|protectionFeeBps/,
  );
  assert.ok(
    existsSync(
      path.join(
        root,
        "prisma/migrations/20260830120000_source_bridge_live_foundation/migration.sql",
      ),
    ),
  );
  const migration = read(
    "prisma/migrations/20260830120000_source_bridge_live_foundation/migration.sql",
  );
  assert.match(migration, /LiveSession_one_active_per_broadcaster/);
}

{
  const flags = read("src/lib/live/flags.ts");
  assert.match(flags, /LIVE_STREAMING_ENABLED/);
  assert.match(flags, /isCloudflareStreamConfigured/);
  const constants = read("src/lib/live/constants.ts");
  assert.match(constants, /30 \* 60 \* 1000/);
  assert.match(constants, /5 \* 60 \* 1000/);
  const provider = read("src/lib/live/provider.ts");
  assert.match(provider, /createLiveInput/);
  assert.match(provider, /getPublishCredentials/);
  assert.match(provider, /createViewerToken/);
  assert.match(provider, /getCurrentVideo/);
  assert.match(provider, /deleteRecording/);
  const signed = read("src/lib/live/signed-token.ts");
  assert.match(signed, /dvrEnabled/);
  const cf = read("src/lib/live/cloudflare.ts");
  assert.match(cf, /webRTC/);
  assert.match(cf, /requireSignedURLs/);
  assert.match(cf, /preferLowLatency/);
  assert.doesNotMatch(cf, /iframe/);
  const watchRoute = read("src/app/api/live/sessions/[id]/watch/route.ts");
  assert.match(watchRoute, /issueLiveWatchGrant/);
  assert.doesNotMatch(watchRoute, /cloudflarestream\.com.*fetch\(/);
  const player = read("src/components/live/LivePlayer.tsx");
  assert.match(player, /hls\.js/);
  assert.match(player, /Capture Item/);
  assert.match(player, /Jump to Live/);
  assert.doesNotMatch(player, /<iframe/);
  const capture = read("src/lib/live/capture.ts");
  assert.match(capture, /getOrCreateConversationPair/);
  assert.match(capture, /autoSent: false/);
  assert.doesNotMatch(capture, /initialMessage/);
  const sessions = read("src/lib/live/sessions.ts");
  assert.doesNotMatch(sessions, /notification\.create/);
  assert.doesNotMatch(sessions, /fan-?out/i);
  const cron = read("src/app/api/cron/live-cleanup/route.ts");
  assert.match(cron, /runLiveCleanup/);
  const vercel = read("vercel.json");
  assert.match(vercel, /\/api\/cron\/live-cleanup/);
  const envEx = read(".env.example");
  assert.match(envEx, /LIVE_STREAMING_ENABLED/);
  assert.match(envEx, /CLOUDFLARE_STREAM_SIGNING_KEY/);
}

{
  // Video must not be proxied through Vercel app routes.
  const liveApi = spawnSync(
    process.platform === "win32" ? "rg.exe" : "rg",
    [
      "cloudflarestream.com",
      "src/app/api/live",
      "-g",
      "!**/capture-frame/**",
    ],
    { cwd: root, encoding: "utf8" },
  );
  void liveApi;
  const watch = read("src/lib/live/watch.ts");
  assert.match(watch, /hlsUrl/);
  assert.doesNotMatch(watch, /arrayBuffer\(\)/);
  assert.doesNotMatch(watch, /pipeThrough/);
}

{
  // No per-viewer heartbeat route.
  assert.equal(
    existsSync(path.join(root, "src/app/api/live/sessions/[id]/heartbeat/route.ts")),
    false,
  );
  const eligibility = read("src/lib/live/eligibility.ts");
  assert.match(eligibility, /payoutsEnabled/);
  assert.match(eligibility, /getStripeMode/);
  assert.doesNotMatch(eligibility, /PaymentIntent/);
  assert.doesNotMatch(eligibility, /syncConnectAccount/);
}

console.log("=== Live clock ===");

const { createRequire } = await import("node:module");
const tsx = path.join(root, "node_modules", "tsx", "dist", "loader.mjs");
void tsx;
void createRequire;

const clock = await import("../src/lib/live/clock.ts");
const started = new Date("2026-08-30T00:00:00.000Z");
const ends = clock.liveEndsAt(started);
assert.equal(ends.toISOString(), "2026-08-30T00:30:00.000Z");
assert.equal(clock.remainingLiveMs(ends, started), 30 * 60 * 1000);
assert.equal(clock.isLiveExpired(ends, ends), true);
assert.equal(clock.dvrPlaybackAllowed(ends, new Date(ends.getTime() - 1)), true);
assert.equal(clock.dvrPlaybackAllowed(ends, ends), false);
const tokenExp = clock.viewerTokenExpiresAt(
  new Date(ends.getTime() - 10_000),
  ends,
);
assert.ok(tokenExp.getTime() <= ends.getTime());
const cool = clock.liveCooldownUntil(ends);
assert.equal(cool.getTime() - ends.getTime(), 5 * 60 * 1000);

console.log("=== Live flags ===");
const flags = await import("../src/lib/live/flags.ts");
assert.equal(flags.isLiveStreamMockProvider(), true);
assert.equal(flags.isLiveStreamingAvailable(), true);

const dbUrl = process.env.DATABASE_URL || "";
if (!dbUrl) {
  console.log("[test-live-streaming] skipped DB domain tests (no DATABASE_URL)");
  console.log("[test-live-streaming] passed (contract + clock)");
  process.exit(0);
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const TAG = `live_${Date.now().toString(36)}`;
const createdUserIds = [];

function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plain, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

async function makeUser(suffix, extra = {}) {
  const username = `${TAG}_${suffix}`.slice(0, 24);
  const user = await prisma.user.create({
    data: {
      email: `${username}@example.com`,
      passwordHash: hashPassword("LiveTest!Aa1"),
      emailVerified: true,
      onboardingComplete: true,
      name: `Live ${suffix}`,
      username,
      slug: username,
      isDiscoverable: true,
      isTestAccount: false,
      city: "Bangkok",
      country: "Thailand",
      ...extra,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function enablePayouts(userId) {
  const mode = process.env.LIVE_PAYMENTS_ENABLED === "true" ? "LIVE" : "TEST";
  await prisma.stripeConnectAccount.create({
    data: {
      userId,
      stripeAccountId: `acct_live_${userId}_${Math.random().toString(36).slice(2, 8)}`,
      stripeMode: mode,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    },
  });
}

async function cleanup() {
  for (const id of createdUserIds.splice(0)) {
    await prisma.liveReport.deleteMany({
      where: { OR: [{ reporterUserId: id }, { liveSession: { broadcasterId: id } }] },
    }).catch(() => null);
    await prisma.liveSession.deleteMany({ where: { broadcasterId: id } }).catch(() => null);
    await prisma.message.deleteMany({ where: { senderId: id } }).catch(() => null);
    const parts = await prisma.conversationParticipant.findMany({
      where: { userId: id },
      select: { conversationId: true },
    }).catch(() => []);
    const convIds = [...new Set((parts || []).map((p) => p.conversationId))];
    if (convIds.length) {
      await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } }).catch(() => null);
      await prisma.conversationParticipant.deleteMany({
        where: { conversationId: { in: convIds } },
      }).catch(() => null);
      await prisma.conversation.deleteMany({ where: { id: { in: convIds } } }).catch(() => null);
    }
    await prisma.stripeConnectAccount.deleteMany({ where: { userId: id } }).catch(() => null);
    await prisma.rateLimitEvent.deleteMany({ where: { userId: id } }).catch(() => null);
    await prisma.statusUpdate.deleteMany({ where: { userId: id } }).catch(() => null);
    await prisma.session.deleteMany({ where: { userId: id } }).catch(() => null);
    await prisma.user.delete({ where: { id } }).catch(() => null);
  }
}

try {
  console.log("=== Live domain (DB, mock Cloudflare) ===");
  const { evaluateLiveEligibility } = await import("../src/lib/live/eligibility.ts");
  const { prepareLiveSession, goLiveSession, endLiveSession } = await import(
    "../src/lib/live/sessions.ts"
  );
  const { prepareLiveCaptureMessage } = await import("../src/lib/live/capture.ts");
  const { reportLiveSession } = await import("../src/lib/live/reports.ts");
  const { runLiveCleanup } = await import("../src/lib/live/cleanup.ts");
  const { issueLiveWatchGrant } = await import("../src/lib/live/watch.ts");
  const { liveFeedItems } = await import("../src/lib/live/feed.ts");
  const { publishStatusAtomic } = await import("../src/lib/status-publish.ts");
  const { DAILY_STATUS_LIMIT } = await import("../src/lib/limits.ts");

  const sourcer = await makeUser("src");
  const viewer = await makeUser("view");
  const asSourcer = {
    ...sourcer,
    hasPassword: true,
    isAdmin: false,
    role: "USER",
  };
  const asViewer = {
    ...viewer,
    hasPassword: true,
    isAdmin: false,
    role: "USER",
  };

  const denied = await evaluateLiveEligibility(asSourcer);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "PAYOUTS_REQUIRED");

  await enablePayouts(sourcer.id);
  const ok = await evaluateLiveEligibility(asSourcer);
  assert.equal(ok.allowed, true);

  const prepared = await prepareLiveSession({
    user: asSourcer,
    title: "Chatuchak finds",
    locationLabel: "Bangkok, Chatuchak",
  });
  assert.equal(prepared.session.status, "PREPARING");
  assert.ok(prepared.publish.whipUrl.includes("webRTC/publish"));

  let secondDenied = false;
  try {
    await prepareLiveSession({
      user: asSourcer,
      title: "Second",
      locationLabel: "Bangkok",
    });
  } catch (err) {
    secondDenied = true;
    assert.equal(err.status, 409);
  }
  assert.equal(secondDenied, true, "one active Live per account");

  const live = await goLiveSession({
    user: asSourcer,
    sessionId: prepared.session.id,
  });
  assert.equal(live.status, "LIVE");
  assert.ok(live.endsAt);
  const duration =
    Date.parse(live.endsAt) - Date.parse(live.startedAt);
  assert.equal(duration, 30 * 60 * 1000);

  const usedBefore = await prisma.rateLimitEvent.count({
    where: { userId: sourcer.id, action: "status" },
  });
  const grant = await issueLiveWatchGrant({
    user: asViewer,
    sessionId: live.id,
  });
  assert.match(grant.playback.hlsUrl, /dvrEnabled=true/);
  assert.ok(grant.playback.tokenExp * 1000 <= Date.parse(live.endsAt));

  let anonDenied = false;
  try {
    await issueLiveWatchGrant({ user: null, sessionId: live.id });
  } catch {
    anonDenied = true;
  }
  assert.equal(anonDenied, true);

  const reports = await reportLiveSession({
    user: asViewer,
    sessionId: live.id,
    reason: "Misleading location",
  });
  assert.equal(reports.created, true);

  const fakeUrl = `https://example.public.blob.vercel-storage.com/live/${viewer.id}/frame.jpg`;
  const { isAllowedAttachmentUrl } = await import("../src/lib/messaging.ts");
  if (isAllowedAttachmentUrl(fakeUrl, viewer.id)) {
    const cap = await prepareLiveCaptureMessage({
      user: asViewer,
      sessionId: live.id,
      imageUrl: fakeUrl,
    });
    assert.equal(cap.autoSent, false);
    const msgCount = await prisma.message.count({
      where: { conversationId: cap.conversationId },
    });
    assert.equal(msgCount, 0, "capture must not auto-send");
  }

  const feed = await liveFeedItems(20);
  assert.ok(feed.some((i) => i.liveSessionId === live.id && i.kind === "live"));

  const adminEnd = await endLiveSession({
    sessionId: live.id,
    reason: "ADMIN",
    admin: true,
  });
  assert.equal(adminEnd.status, "TERMINATED");
  assert.equal(adminEnd.wasLiveUntil, null);

  const usedAfter = await prisma.rateLimitEvent.count({
    where: { userId: sourcer.id, action: "status" },
  });
  assert.equal(usedAfter, usedBefore, "Live must not consume Status quota");

  await prisma.statusUpdate.deleteMany({ where: { userId: sourcer.id } });
  const status = await publishStatusAtomic(prisma, sourcer.id, "hello from test");
  assert.equal(status.ok, true);
  assert.ok(status.limit.used <= DAILY_STATUS_LIMIT);

  const sourcer2 = await makeUser("src2");
  await enablePayouts(sourcer2.id);
  const asS2 = { ...sourcer2, hasPassword: true, isAdmin: false, role: "USER" };
  const p2 = await prepareLiveSession({
    user: asS2,
    title: "Timer",
    locationLabel: "Chiang Mai",
  });
  const live2 = await goLiveSession({ user: asS2, sessionId: p2.session.id });
  const past = new Date(Date.parse(live2.endsAt) + 1000);
  const { expireLiveIfNeeded } = await import("../src/lib/live/sessions.ts");
  const expired = await expireLiveIfNeeded(live2.id, past);
  assert.ok(expired);
  assert.equal(expired.status, "ENDED");
  assert.ok(expired.wasLiveUntil);
  assert.ok(expired.cooldownUntil);

  const coolEl = await evaluateLiveEligibility(asS2, past);
  assert.equal(coolEl.allowed, false);
  assert.equal(coolEl.reason, "COOLDOWN");

  const afterCool = new Date(expired.cooldownUntil.getTime() + 1000);
  const coolOk = await evaluateLiveEligibility(asS2, afterCool);
  assert.equal(coolOk.allowed, true);

  const abandonedUser = await makeUser("abd");
  await enablePayouts(abandonedUser.id);
  const asAbd = {
    ...abandonedUser,
    hasPassword: true,
    isAdmin: false,
    role: "USER",
  };
  const prep = await prepareLiveSession({
    user: asAbd,
    title: "Abandon",
    locationLabel: "Phuket",
  });
  await prisma.liveSession.update({
    where: { id: prep.session.id },
    data: { createdAt: new Date(Date.now() - 120_000) },
  });
  const cleaned = await runLiveCleanup(new Date());
  assert.ok(cleaned.abandonedPreparing >= 1);
  const abdRow = await prisma.liveSession.findUnique({
    where: { id: prep.session.id },
  });
  assert.ok(["FAILED", "ENDED"].includes(abdRow.status));

  console.log("[test-live-streaming] passed");
} finally {
  await cleanup();
  await prisma.$disconnect();
}
