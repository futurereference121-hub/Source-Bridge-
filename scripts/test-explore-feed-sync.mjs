/**
 * Explore Live feed realtime sync — Status replace + Opportunity append,
 * feedVersion poll, stale-response guards (contract + DB).
 *
 * Run: npx tsx --env-file=.env scripts/test-explore-feed-sync.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { publishStatusAtomic } from "../src/lib/status-publish.ts";
import { buildMergedLiveFeed } from "../src/lib/members-service.ts";
import {
  encodeExploreFeedVersion,
  getExploreFeedVersion,
  maxFeedContentVersion,
  shouldApplyExploreFeedPayload,
} from "../src/lib/explore-feed-activity.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const prisma = new PrismaClient();
const TAG = `ex_sync_${Date.now().toString(36)}`;
const createdUserIds = [];

function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plain, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

async function makeUser(suffix) {
  const username = `${TAG}_${suffix}`.slice(0, 24);
  const user = await prisma.user.create({
    data: {
      email: `${username}@example.com`,
      passwordHash: hashPassword("ExploreSync!Aa1"),
      emailVerified: true,
      onboardingComplete: true,
      name: `Explore Sync ${suffix}`,
      username,
      slug: username,
      isDiscoverable: true,
      isTestAccount: false,
      city: "Bangkok",
      country: "Thailand",
      bio: "sync test",
      publicDisplayMessage: "sync test",
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function hardCleanup(userId) {
  await prisma.rateLimitEvent.deleteMany({ where: { userId } });
  await prisma.statusUpdate.deleteMany({ where: { userId } });
  await prisma.opportunity.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.notification
    .deleteMany({ where: { OR: [{ userId }, { actorId: userId }] } })
    .catch(() => null);
  await prisma.follow
    .deleteMany({
      where: { OR: [{ followerId: userId }, { followingId: userId }] },
    })
    .catch(() => null);
  await prisma.user.delete({ where: { id: userId } }).catch(() => null);
}

function statusCardsFor(feed, userId) {
  return feed.filter((i) => i.kind === "status" && i.memberId === userId);
}

function oppCardsFor(feed, userId) {
  return feed.filter((i) => i.kind === "opportunity" && i.memberId === userId);
}

// --- Source contracts (Tests 4–7 wiring) ---
{
  const explore = read("src/app/explore/ExploreClient.tsx");
  assert.match(explore, /EXPLORE_FEED_SOFT_POLL_MS\s*=\s*2500/);
  assert.match(explore, /poll=1/);
  assert.match(explore, /sinceVersion/);
  assert.match(explore, /visibilityState/);
  assert.match(explore, /subscribeStatusChanged/);
  assert.match(explore, /subscribeOpportunityChanged/);
  assert.match(explore, /refreshFeed\(\{\s*force:\s*true\s*\}\)/);
  // Soft-poll must not reset People/search via members fetch.
  const softBlock = explore.slice(
    explore.indexOf("async function softPollFeed"),
    explore.indexOf("void refreshFeed({ force: true })"),
  );
  assert.doesNotMatch(softBlock, /fetchMembersPage/);
  assert.doesNotMatch(softBlock, /router\.refresh/);

  const feedRoute = read("src/app/api/feed/route.ts");
  assert.match(feedRoute, /unchanged:\s*true/);
  assert.match(feedRoute, /getExploreFeedVersion/);

  const oppEditor = read("src/components/profile/editors/OpportunityEditor.tsx");
  assert.match(oppEditor, /emitOpportunityChanged/);

  // TEST 5 — stale-response helper
  assert.equal(
    shouldApplyExploreFeedPayload({
      requestSeq: 1,
      latestSeq: 2,
      incomingVersion: "s1c1|o0c0",
      appliedVersion: "s0c0|o0c0",
      incomingContentMax: 100,
      appliedContentMax: 50,
    }),
    false,
    "stale seq must be rejected",
  );
  assert.equal(
    shouldApplyExploreFeedPayload({
      requestSeq: 2,
      latestSeq: 2,
      incomingVersion: "s1c1|o0c0",
      appliedVersion: "s1c1|o0c0",
      incomingContentMax: 100,
      appliedContentMax: 100,
    }),
    false,
    "same feedVersion must skip setState",
  );
  assert.equal(
    shouldApplyExploreFeedPayload({
      requestSeq: 2,
      latestSeq: 2,
      incomingVersion: "s2c1|o0c0",
      appliedVersion: "s1c1|o0c0",
      incomingContentMax: 200,
      appliedContentMax: 100,
    }),
    true,
    "new feedVersion must apply",
  );
  assert.equal(
    shouldApplyExploreFeedPayload({
      requestSeq: 2,
      latestSeq: 2,
      incomingVersion: null,
      appliedVersion: "",
      incomingContentMax: 50,
      appliedContentMax: 100,
    }),
    false,
    "legacy older content clock rejected",
  );
  assert.equal(
    encodeExploreFeedVersion({
      statusMaxMs: 10,
      statusCount: 2,
      statusIdSig: "abc",
      opportunityMaxMs: 20,
      opportunityCount: 3,
      opportunityIdSig: "def",
      liveMaxMs: 0,
      liveCount: 0,
      liveIdSig: "0",
    }),
    "s10c2iabc|o20c3idef|l0c0i0",
  );
  assert.equal(
    maxFeedContentVersion([
      {
        id: "a",
        kind: "status",
        memberId: "1",
        memberSlug: "a",
        username: "a",
        fullName: "A",
        photo: "",
        text: "x",
        postedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "b",
        kind: "opportunity",
        memberId: "2",
        memberSlug: "b",
        username: "b",
        fullName: "B",
        photo: "",
        text: "y",
        postedAt: "2026-06-01T00:00:00.000Z",
      },
    ]),
    Date.parse("2026-06-01T00:00:00.000Z"),
  );
}

async function main() {
  const t0 = new Date(Date.now() - 30 * 60 * 1000);
  const userA = await makeUser("a");

  const v0 = await getExploreFeedVersion(t0);

  // TEST 1 — Status publish bumps feedVersion and appears remotely (feed builder)
  const text1 = "Explore sync status one — looking for tea.";
  const pub1 = await publishStatusAtomic(prisma, {
    userId: userA.id,
    text: text1,
    now: t0,
    idempotencyKey: `${TAG}_s1`,
  });
  assert.equal(pub1.ok, true);
  const v1 = await getExploreFeedVersion(t0);
  assert.notEqual(v1, v0, "Status publish must change feedVersion");
  const feed1 = await buildMergedLiveFeed(8);
  const cards1 = statusCardsFor(feed1, userA.id);
  assert.equal(cards1.length, 1, "exactly one Status card");
  assert.match(cards1[0].text, /tea/);

  // TEST 2 — Status replace (no duplicates)
  const t1 = new Date(t0.getTime() + 60 * 60 * 1000 + 1000);
  const text2 = "Explore sync status two — replaced.";
  const pub2 = await publishStatusAtomic(prisma, {
    userId: userA.id,
    text: text2,
    now: t1,
    idempotencyKey: `${TAG}_s2`,
  });
  assert.equal(pub2.ok, true);
  const v2 = await getExploreFeedVersion(t1);
  assert.notEqual(v2, v1, "Status replace must change feedVersion");
  const feed2 = await buildMergedLiveFeed(8);
  const cards2 = statusCardsFor(feed2, userA.id);
  assert.equal(cards2.length, 1, "Status replace keeps one card");
  assert.match(cards2[0].text, /replaced/);

  // TEST 3 — Opportunity append (does NOT apply Status 1-card limit)
  const opp1 = await prisma.opportunity.create({
    data: {
      userId: userA.id,
      title: "Need camera lens",
      description: "Looking for a used 50mm lens in Bangkok",
      city: "Bangkok",
      country: "Thailand",
      category: "General",
      postedAt: new Date(t1.getTime() + 5000),
    },
  });
  const v3 = await getExploreFeedVersion(new Date(t1.getTime() + 5000));
  assert.notEqual(v3, v2, "Opportunity publish must change feedVersion");
  const feed3 = await buildMergedLiveFeed(8);
  const opps3 = oppCardsFor(feed3, userA.id);
  assert.ok(opps3.some((o) => o.id === `opp-${opp1.id}`));
  assert.equal(statusCardsFor(feed3, userA.id).length, 1);

  const opp2 = await prisma.opportunity.create({
    data: {
      userId: userA.id,
      title: "Second opportunity",
      description: "Also need film stock",
      city: "Bangkok",
      country: "Thailand",
      category: "General",
      postedAt: new Date(t1.getTime() + 10000),
    },
  });
  const feed4 = await buildMergedLiveFeed(8);
  const opps4 = oppCardsFor(feed4, userA.id);
  assert.ok(
    opps4.length >= 2,
    "multiple Opportunities for same user must append",
  );
  assert.ok(opps4.some((o) => o.id === `opp-${opp2.id}`));
  assert.equal(
    statusCardsFor(feed4, userA.id).length,
    1,
    "Status limits must not collapse Opportunities",
  );

  // Poll unchanged semantics (remote soft-poll cheap path)
  const current = await getExploreFeedVersion();
  assert.equal(current, await getExploreFeedVersion(), "stable when idle");

  console.log("[test-explore-feed-sync] passed");
}

main()
  .catch((err) => {
    console.error("[test-explore-feed-sync] FAILED", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const id of createdUserIds) {
      await hardCleanup(id);
    }
    await prisma.$disconnect();
  });
