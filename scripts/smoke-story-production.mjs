/**
 * Production Story smoke test against live www.sourcebridge.app.
 * Creates temporary users, uploads a short clip, verifies rings/views, cleans up.
 *
 *   node --env-file=.env.local --import=dotenv/config scripts/smoke-story-production.mjs
 */
import { randomBytes, scryptSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.SMOKE_BASE_URL || "https://www.sourcebridge.app";
const PASSWORD = "StorySmoke!2026Aa";
const TAG = `story_smoke_${Date.now().toString(36)}`;
const FFMPEG =
  process.env.FFMPEG_PATH ||
  "C:\\ffmpeg\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe";

const prisma = new PrismaClient();

function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plain, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function signIn(identifier) {
  const jar = { cookie: "" };
  const res = await fetch(`${BASE}/api/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const raw = setCookie.length
    ? setCookie
    : [res.headers.get("set-cookie")].filter(Boolean);
  jar.cookie = raw
    .map((c) => String(c).split(";")[0])
    .filter(Boolean)
    .join("; ");
  const data = await res.json().catch(() => ({}));
  assert(res.ok, `sign-in failed for ${identifier}: ${data.error || res.status}`);
  assert(jar.cookie.includes("sb_session"), "missing session cookie");
  return jar;
}

async function api(jar, path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (jar?.cookie) headers.set("cookie", jar.cookie);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function makeVideo(dir) {
  const out = join(dir, "clip.mp4");
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x240:d=2",
      "-f",
      "lavfi",
      "-i",
      "sine=f=440:d=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      "-t",
      "2",
      out,
    ],
    { stdio: "ignore" },
  );
  return out;
}

async function createUser(suffix) {
  const username = `${TAG}_${suffix}`.slice(0, 24);
  const email = `${username}@sourcebridge.test`;
  const slug = username;
  const user = await prisma.user.create({
    data: {
      email,
      username,
      slug,
      name: `Story Smoke ${suffix}`,
      passwordHash: hashPassword(PASSWORD),
      emailVerified: true,
      onboardingComplete: true,
      isDiscoverable: true,
      isTestAccount: true,
      city: "Bangkok",
      country: "Thailand",
      memberType: "LOCAL",
      photo: "",
      cover: "",
      bio: "temporary story smoke test",
      publicDisplayMessage: "temporary story smoke test",
    },
  });
  return user;
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "sb-story-"));
  let userA;
  let userB;
  let clipId;
  try {
    console.log(`Base: ${BASE}`);
    userA = await createUser("a");
    userB = await createUser("b");
    console.log(`Created ${userA.username} / ${userB.username}`);

    const videoPath = makeVideo(dir);
    const bytes = readFileSync(videoPath);
    assert(bytes.length > 1000, "video too small");

    const jarA = await signIn(userA.username);
    const jarB = await signIn(userB.username);

    // Owner create flow: GET stories should work
    {
      const { res, data } = await api(jarA, "/api/stories");
      assert(res.ok, `GET /api/stories: ${data.error || res.status}`);
      assert(Array.isArray(data.clips), "clips array missing");
    }

    // Upload
    {
      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes], { type: "video/mp4" }),
        "clip.mp4",
      );
      form.append("durationSec", "2");
      const { res, data } = await api(jarA, "/api/stories", {
        method: "POST",
        body: form,
      });
      assert(res.ok, `upload failed: ${data.error || res.status}`);
      assert(data.clip?.id, "clip id missing");
      clipId = data.clip.id;
      console.log(`Uploaded clip ${clipId}`);
    }

    // Ring for A
    {
      const { res, data } = await api(
        jarB,
        `/api/stories/rings?userIds=${encodeURIComponent(userA.id)}`,
      );
      assert(res.ok, `rings failed: ${data.error || res.status}`);
      const ring = data.rings?.[userA.id];
      assert(ring?.hasActiveStory === true, "expected active story ring");
      console.log("Ring OK", ring);
    }

    // Viewer open story
    {
      const { res, data } = await api(jarB, `/api/stories/user/${userA.id}`);
      assert(res.ok, `viewer load failed: ${data.error || res.status}`);
      assert(data.clips?.length === 1, "expected 1 clip");
    }

    // Record view
    {
      const { res, data } = await api(jarB, `/api/stories/${clipId}/view`, {
        method: "POST",
      });
      assert(res.ok, `view failed: ${data.error || res.status}`);
      console.log("View recorded", data);
    }

    // Owner manage shows view count
    {
      const { res, data } = await api(jarA, "/api/stories");
      assert(res.ok, "owner reload failed");
      const clip = data.clips?.find((c) => c.id === clipId);
      assert(clip, "clip missing for owner");
      assert((clip.viewCount ?? 0) >= 1, `expected views >= 1, got ${clip.viewCount}`);
      console.log(`View count: ${clip.viewCount}`);
    }

    // Delete
    {
      const { res, data } = await api(jarA, `/api/stories/${clipId}`, {
        method: "DELETE",
      });
      assert(res.ok, `delete failed: ${data.error || res.status}`);
      clipId = null;
      console.log("Deleted clip");
    }

    // Ring gone
    {
      const { res, data } = await api(
        jarB,
        `/api/stories/rings?userIds=${encodeURIComponent(userA.id)}`,
      );
      assert(res.ok, "rings after delete failed");
      const ring = data.rings?.[userA.id];
      assert(ring?.hasActiveStory === false, "ring should be gone");
      console.log("Ring cleared OK");
    }

    console.log("smoke-story-production: PASS");
  } finally {
    try {
      if (clipId && userA) {
        await prisma.storyClip.updateMany({
          where: { id: clipId },
          data: { status: "DELETED", deletedAt: new Date() },
        });
      }
      if (userA || userB) {
        const ids = [userA?.id, userB?.id].filter(Boolean);
        await prisma.storyView.deleteMany({
          where: { OR: [{ viewerUserId: { in: ids } }, { storyClip: { userId: { in: ids } } }] },
        });
        await prisma.storyReport.deleteMany({
          where: {
            OR: [
              { reporterUserId: { in: ids } },
              { storyClip: { userId: { in: ids } } },
            ],
          },
        });
        await prisma.storyClip.deleteMany({ where: { userId: { in: ids } } });
        await prisma.session.deleteMany({ where: { userId: { in: ids } } });
        await prisma.user.deleteMany({ where: { id: { in: ids } } });
        console.log("Temp users removed");
      }
    } catch (err) {
      console.error("cleanup error", err);
    }
    rmSync(dir, { recursive: true, force: true });
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
