/**
 * Targeted Status tests 1–7 (real user flow + cleanup).
 * Creates temporary discoverable users, asserts Explore feed, always deletes fixtures.
 *
 * Run: npx tsx --env-file=.env scripts/test-status-explore-flow.mjs
 */
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  publishStatusAtomic,
  readStatusPublishState,
} from "../src/lib/status-publish.ts";
import { pickActiveStatus } from "../src/lib/member-status.ts";
import { buildMergedLiveFeed } from "../src/lib/members-service.ts";

const prisma = new PrismaClient();
const TAG = `st_flow_${Date.now().toString(36)}`;
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
      passwordHash: hashPassword("StatusFlow!Aa1"),
      emailVerified: true,
      onboardingComplete: true,
      name: `Status Flow ${suffix}`,
      username,
      slug: username,
      isDiscoverable: true,
      // Must be false to appear in Explore; cleanup MUST delete this user.
      isTestAccount: false,
      city: "Phuket",
      country: "Thailand",
      bio: "flow test",
      publicDisplayMessage: "flow test",
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function hardCleanup(userId) {
  await prisma.rateLimitEvent.deleteMany({ where: { userId } });
  await prisma.statusUpdate.deleteMany({ where: { userId } });
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
  const gone = await prisma.user.findUnique({ where: { id: userId } });
  if (gone) throw new Error(`cleanup failed for ${userId}`);
}

function statusCardsFor(feed, userId) {
  return feed.filter((i) => i.kind === "status" && i.memberId === userId);
}

async function main() {
  const t0 = new Date("2026-08-25T14:00:00.000Z");
  const userA = await makeUser("a");
  const userB = await makeUser("b");

  // TEST 1 — publish appears on profile state + Explore feed
  const text1 = "Looking around Phuket market today.";
  const pub1 = await publishStatusAtomic(prisma, {
    userId: userA.id,
    text: text1,
    now: t0,
  });
  assert.equal(pub1.ok, true);
  if (!pub1.ok) throw new Error("T1 publish failed");
  const state1 = await readStatusPublishState(prisma, userA.id, t0);
  assert.equal(state1.active?.text, text1);
  assert.equal(pickActiveStatus([state1.active]).text, text1);
  let feed = await buildMergedLiveFeed(8);
  let cards = statusCardsFor(feed, userA.id);
  assert.equal(cards.length, 1, "T1 Explore one card");
  assert.equal(cards[0].text, text1);
  console.log("TEST 1 PASS");

  // TEST 2 — refresh Explore (rebuild feed) still shows same Status
  feed = await buildMergedLiveFeed(8);
  cards = statusCardsFor(feed, userA.id);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].text, text1);
  console.log("TEST 2 PASS");

  // TEST 3 — User B's Explore view sees User A (same public feed query)
  feed = await buildMergedLiveFeed(40);
  cards = statusCardsFor(feed, userA.id);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].text, text1);
  // User B has no status — must not appear
  assert.equal(statusCardsFor(feed, userB.id).length, 0);
  console.log("TEST 3 PASS");

  // TEST 4 — replace after 1h → one card, new text
  const t1 = new Date(t0.getTime() + 60 * 60 * 1000);
  const text2 = "Now at the night market.";
  const pub2 = await publishStatusAtomic(prisma, {
    userId: userA.id,
    text: text2,
    now: t1,
  });
  assert.equal(pub2.ok, true);
  feed = await buildMergedLiveFeed(40);
  cards = statusCardsFor(feed, userA.id);
  assert.equal(cards.length, 1, "T4 one card after replace");
  assert.equal(cards[0].text, text2);
  const actives = await prisma.statusUpdate.findMany({
    where: { userId: userA.id, expiresAt: { gt: t1 } },
  });
  assert.equal(actives.length, 1);
  console.log("TEST 4 PASS");

  // TEST 5 — double-submit same text within 60s → one active, one daily burn
  const dup = await publishStatusAtomic(prisma, {
    userId: userA.id,
    text: text2,
    now: new Date(t1.getTime() + 5_000),
  });
  assert.equal(dup.ok, true);
  if (!dup.ok) throw new Error("dup");
  assert.equal(dup.existing, true);
  const dayUsed = await prisma.rateLimitEvent.count({
    where: { userId: userA.id, action: "status", dayKey: "2026-08-25" },
  });
  assert.equal(dayUsed, 2);
  feed = await buildMergedLiveFeed(40);
  assert.equal(statusCardsFor(feed, userA.id).length, 1);
  console.log("TEST 5 PASS");

  // TEST 6 — expired Status not in Explore
  const expiredAt = new Date(t1.getTime() + 24 * 60 * 60 * 1000 + 1);
  // Expire against wall-clock (Explore feed query uses real now).
  await prisma.statusUpdate.updateMany({
    where: { userId: userA.id, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  });
  feed = await buildMergedLiveFeed(40);
  assert.equal(statusCardsFor(feed, userA.id).length, 0);
  const hist = await prisma.statusUpdate.findMany({
    where: { userId: userA.id },
    orderBy: { postedAt: "desc" },
  });
  assert.equal(pickActiveStatus(hist, expiredAt), null);
  assert.equal(pickActiveStatus(hist, new Date()), null);
  console.log("TEST 6 PASS");

  // Bonus: 3/day + cooldown still enforced
  const uC = await makeUser("c");
  const c0 = new Date("2026-08-25T16:00:00.000Z");
  assert.equal(
    (await publishStatusAtomic(prisma, { userId: uC.id, text: "c1", now: c0 })).ok,
    true,
  );
  const cool = await publishStatusAtomic(prisma, {
    userId: uC.id,
    text: "c2",
    now: new Date(c0.getTime() + 30 * 60 * 1000),
  });
  assert.equal(cool.ok, false);
  if (cool.ok) throw new Error("cooldown");
  assert.equal(cool.code, "STATUS_COOLDOWN");
  let used = 1;
  for (let i = 0; i < 2; i++) {
    const r = await publishStatusAtomic(prisma, {
      userId: uC.id,
      text: `c${i + 2}`,
      now: new Date(c0.getTime() + (i + 1) * 60 * 60 * 1000),
    });
    assert.equal(r.ok, true);
    used++;
  }
  const fourth = await publishStatusAtomic(prisma, {
    userId: uC.id,
    text: "c4",
    now: new Date(c0.getTime() + 4 * 60 * 60 * 1000),
  });
  assert.equal(fourth.ok, false);
  if (fourth.ok) throw new Error("daily");
  assert.equal(fourth.code, "STATUS_DAILY_LIMIT");
  assert.equal(used, 3);
  console.log("3/day + 1h PASS");

  console.log("\n[test-status-explore-flow] ALL TESTS 1–6 PASS\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // TEST 7 — cleanup leaves no fixtures
    const leftovers = [];
    for (const id of createdUserIds) {
      try {
        await hardCleanup(id);
      } catch (e) {
        leftovers.push({ id, error: String(e) });
        process.exitCode = 1;
      }
    }
    const still = await prisma.user.findMany({
      where: { id: { in: createdUserIds } },
      select: { id: true, username: true },
    });
    if (still.length || leftovers.length) {
      console.error("TEST 7 FAIL", { still, leftovers });
      process.exitCode = 1;
    } else {
      console.log("TEST 7 PASS — no leftover fixtures");
    }
    await prisma.$disconnect();
  });
