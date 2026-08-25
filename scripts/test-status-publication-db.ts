/**
 * Targeted Status publication DB tests A–H against Neon (TEST).
 * Run: npx tsx --env-file=.env scripts/test-status-publication-db.ts
 */
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  deleteActiveStatus,
  publishStatusAtomic,
  readStatusPublishState,
} from "../src/lib/status-publish";

const prisma = new PrismaClient();

function hashPassword(plain: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plain, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

async function makeUser(tag: string) {
  const username = tag.slice(0, 24);
  return prisma.user.create({
    data: {
      email: `${tag}@example.com`,
      passwordHash: hashPassword("StatusTest!Aa1"),
      emailVerified: true,
      onboardingComplete: true,
      name: "Status DB Test",
      username,
      slug: username,
      isDiscoverable: true,
      isTestAccount: true,
      city: "Test City",
      country: "Testland",
    },
  });
}

async function cleanup(userId: string) {
  await prisma.rateLimitEvent.deleteMany({ where: { userId } });
  await prisma.statusUpdate.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } }).catch(() => null);
}

async function actives(userId: string, now: Date) {
  return prisma.statusUpdate.findMany({
    where: { userId, expiresAt: { gt: now } },
    orderBy: { postedAt: "desc" },
  });
}

async function dailyCount(userId: string, dayKey: string) {
  return prisma.rateLimitEvent.count({
    where: { userId, action: "status", dayKey },
  });
}

const tag = `st_db_${Date.now().toString(36)}`;
const t0 = new Date("2026-08-25T12:00:00.000Z");

async function main() {
  const user = await makeUser(tag);

  try {
  // A — first publish
  const a = await publishStatusAtomic(prisma, {
    userId: user.id,
    text: "A first",
    now: t0,
  });
  assert.equal(a.ok, true);
  if (!a.ok) throw new Error("A failed");
  assert.equal(a.existing, undefined);
  assert.equal(a.status.text, "A first");
  assert.equal((await actives(user.id, t0)).length, 1);
  assert.equal(await dailyCount(user.id, "2026-08-25"), 1);
  console.log("A PASS");

  // E — within 1h blocked
  const e = await publishStatusAtomic(prisma, {
    userId: user.id,
    text: "E too soon",
    now: new Date(t0.getTime() + 30 * 60 * 1000),
  });
  assert.equal(e.ok, false);
  if (e.ok) throw new Error("E should fail");
  assert.equal(e.code, "STATUS_COOLDOWN");
  assert.equal(await dailyCount(user.id, "2026-08-25"), 1);
  console.log("E PASS");

  // same-text idempotent within 60s
  const dup = await publishStatusAtomic(prisma, {
    userId: user.id,
    text: "A first",
    now: new Date(t0.getTime() + 10_000),
  });
  assert.equal(dup.ok, true);
  if (!dup.ok) throw new Error("dup failed");
  assert.equal(dup.existing, true);
  assert.equal(dup.status.id, a.status.id);
  assert.equal(await dailyCount(user.id, "2026-08-25"), 1);
  console.log("double-click same-text PASS");

  // B — replace after 1h
  const t1 = new Date(t0.getTime() + 60 * 60 * 1000);
  const b = await publishStatusAtomic(prisma, {
    userId: user.id,
    text: "B replace",
    now: t1,
  });
  assert.equal(b.ok, true);
  const activeB = await actives(user.id, t1);
  assert.equal(activeB.length, 1);
  assert.equal(activeB[0].text, "B replace");
  assert.equal(await dailyCount(user.id, "2026-08-25"), 2);
  console.log("B PASS");

  // C — third of day
  const t2 = new Date(t1.getTime() + 60 * 60 * 1000);
  const c = await publishStatusAtomic(prisma, {
    userId: user.id,
    text: "C third",
    now: t2,
  });
  assert.equal(c.ok, true);
  assert.equal(await dailyCount(user.id, "2026-08-25"), 3);
  assert.equal((await actives(user.id, t2)).length, 1);
  console.log("C PASS");

  // D — fourth blocked
  const t3 = new Date(t2.getTime() + 60 * 60 * 1000);
  const d = await publishStatusAtomic(prisma, {
    userId: user.id,
    text: "D fourth",
    now: t3,
  });
  assert.equal(d.ok, false);
  if (d.ok) throw new Error("D should fail");
  assert.equal(d.code, "STATUS_DAILY_LIMIT");
  assert.equal(await dailyCount(user.id, "2026-08-25"), 3);
  console.log("D PASS");

  // F — concurrent double-submit
  const userF = await makeUser(`${tag}_f`);
  const tf = new Date("2026-08-25T18:00:00.000Z");
  const [f1, f2] = await Promise.all([
    publishStatusAtomic(prisma, {
      userId: userF.id,
      text: "F concurrent one",
      now: tf,
    }),
    publishStatusAtomic(prisma, {
      userId: userF.id,
      text: "F concurrent one",
      now: tf,
    }),
  ]);
  assert.equal(await dailyCount(userF.id, "2026-08-25"), 1);
  assert.equal((await actives(userF.id, tf)).length, 1);
  assert.ok([f1, f2].every((r) => r.ok));
  await cleanup(userF.id);
  console.log("F PASS");

  // G — next calendar day resets
  const tNext = new Date("2026-08-26T00:30:00.000Z");
  const g = await publishStatusAtomic(prisma, {
    userId: user.id,
    text: "G next day",
    now: tNext,
  });
  assert.equal(g.ok, true);
  assert.equal(await dailyCount(user.id, "2026-08-26"), 1);
  assert.equal(await dailyCount(user.id, "2026-08-25"), 3);
  console.log("G PASS");

  // H — 24h expiry
  const posted = new Date(tNext.getTime() + 60 * 60 * 1000);
  const hPub = await publishStatusAtomic(prisma, {
    userId: user.id,
    text: "H expires",
    now: posted,
  });
  assert.equal(hPub.ok, true);
  const beforeExpiry = new Date(posted.getTime() + 23 * 60 * 60 * 1000);
  assert.equal((await actives(user.id, beforeExpiry)).length, 1);
  const afterExpiry = new Date(posted.getTime() + 24 * 60 * 60 * 1000 + 1);
  assert.equal((await actives(user.id, afterExpiry)).length, 0);
  const state = await readStatusPublishState(prisma, user.id, afterExpiry);
  assert.equal(state.active, null);
  const mid = new Date(posted.getTime() + 60 * 60 * 1000);
  await deleteActiveStatus(prisma, user.id, mid);
  const hist = await prisma.statusUpdate.count({ where: { userId: user.id } });
  assert.ok(hist >= 4);
  assert.equal(await dailyCount(user.id, "2026-08-26"), 2);
  console.log("H PASS");

  console.log("\n[test-status-publication-db] ALL A–H PASS\n");
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await cleanup(user.id);
    await prisma.$disconnect();
  }
}

main();
