/**
 * Smoke tests for Stories constants, schema presence, and old video removal.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

{
  const schema = read("prisma/schema.prisma");
  assert.ok(/model StoryClip/.test(schema));
  assert.ok(/model StoryView/.test(schema));
  assert.ok(/model StoryReport/.test(schema));
  assert.ok(/@@index\(\[userId, status, expiresAt\]\)/.test(schema));
  assert.ok(/@@unique\(\[storyClipId, viewerUserId\]\)/.test(schema));
}

{
  assert.ok(
    existsSync(join(root, "prisma/migrations/20260731160000_story_clips/migration.sql")),
  );
}

{
  const view = read("src/components/profile/MemberProfileView.tsx");
  assert.ok(
    !/ProfileVideoSection/.test(view),
    "Permanent profile video section must be removed",
  );
  assert.ok(!existsSync(join(root, "src/components/profile/ProfileVideoSection.tsx")));
}

{
  const videoApi = read("src/app/api/profile/video/route.ts");
  assert.ok(/PROFILE_VIDEO_REMOVED/.test(videoApi));
  assert.ok(/410/.test(videoApi));
}

{
  const hero = read("src/components/stories/StoryProvider.tsx");
  assert.ok(/Create Story|StoryCreateModal/.test(hero));
  assert.ok(/StoryManageModal/.test(hero));
  assert.ok(/StoryViewer/.test(hero));
}

{
  const inbox = read("src/components/messaging/MessagesInbox.tsx");
  assert.ok(/StoryAvatar/.test(inbox));
}

{
  const explore = read("src/app/explore/ExploreClient.tsx");
  assert.ok(/refreshRings/.test(explore));
}

{
  const constants = read("src/lib/story-constants.ts");
  assert.ok(/MAX_STORY_CLIP_SECONDS = 90/.test(constants));
  assert.ok(/MAX_ACTIVE_STORY_SECONDS = 90 \* 60/.test(constants));
  assert.ok(/MAX_STORY_CLIP_BYTES = 50 \* 1024 \* 1024/.test(constants));
}

{
  const storage = read("src/lib/storage.ts");
  assert.ok(/storeVideoForUser/.test(storage));
  assert.ok(/stories\/\$\{userId\}/.test(storage) || /stories\//.test(storage));
}

{
  const vercel = read("vercel.json");
  assert.ok(/stories-expire/.test(vercel));
  // Hobby plan: daily cron only — hourly schedules fail Vercel deploy.
  assert.ok(/"schedule": "0 4 \* \* \*"/.test(vercel));
  assert.ok(!/"schedule": "0 \* \* \* \*"/.test(vercel));
}

{
  const deletion = read("src/lib/account-deletion.ts");
  assert.ok(/storyClip/.test(deletion));
  assert.ok(/profileVideoUrl/.test(deletion));
}

console.log("test-stories: ok");
