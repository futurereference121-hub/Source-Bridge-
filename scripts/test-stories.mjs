/**
 * Smoke tests for Stories: schema, direct-to-Blob flow, simplified create UX.
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
  assert.ok(/uploadSessionId/.test(schema));
  assert.ok(/model StoryView/.test(schema));
  assert.ok(/model StoryReport/.test(schema));
}

{
  const view = read("src/components/profile/MemberProfileView.tsx");
  assert.ok(!/ProfileVideoSection/.test(view));
  assert.ok(!existsSync(join(root, "src/components/profile/ProfileVideoSection.tsx")));
}

{
  const avatar = read("src/components/stories/StoryAvatar.tsx");
  assert.ok(/Add Story/.test(avatar));
  assert.ok(/aria-label=\{hasActive \? "Add to Story" : "Add Story"\}/.test(avatar) || /aria-label=.*Add Story/.test(avatar));
  assert.ok(/Plus/.test(avatar));
}

{
  const create = read("src/components/stories/StoryCreateModal.tsx");
  assert.ok(/Record Story/.test(create));
  assert.ok(/Choose Video/.test(create));
  assert.ok(/Preview Story|preview/.test(create));
  assert.ok(/Add to Story/.test(create));
  assert.ok(/capture="environment"/.test(create));
  assert.ok(/ref=\{recordRef\}[\s\S]*capture="environment"/.test(create));
  assert.ok(/ref=\{chooseRef\}/.test(create));
  assert.ok(!/Record \/ Choose from device/.test(create));
  assert.ok(!/>\s*Upload Video\s*</.test(create));
  assert.ok(/setStep\("preview"\)/.test(create));
  assert.ok(/confirmUpload/.test(create));
  assert.ok(/@vercel\/blob\/client/.test(create));
  assert.ok(/\/api\/stories\/prepare/.test(create));
  assert.ok(/\/api\/stories\/finalize/.test(create));
  assert.ok(/Choose Another Video/.test(create));
  assert.ok(/Duration will be verified during upload/.test(create));
  assert.ok(/storyErrorMessage|STORY_FILE_TOO_LARGE|StoryUploadErrorCode/.test(create));
}

{
  const owner = read("src/components/stories/StoryOwnerMenu.tsx");
  assert.ok(/View Story/.test(owner));
  assert.ok(/Add to Story/.test(owner));
  assert.ok(/Manage Story/.test(owner));
  assert.ok(/Cancel/.test(owner));
}

{
  const provider = read("src/components/stories/StoryProvider.tsx");
  assert.ok(/Story added/.test(provider));
}

{
  const constants = read("src/lib/story-constants.ts");
  assert.ok(/MAX_STORY_CLIP_SECONDS = 90/.test(constants));
  assert.ok(/MAX_ACTIVE_STORY_SECONDS = 90 \* 60/.test(constants));
  assert.ok(/MAX_STORY_CLIP_BYTES = 100/.test(constants));
  assert.ok(/STORY_FILE_TOO_LARGE/.test(constants));
  assert.ok(/resolveStoryMime/.test(constants));
}

{
  assert.ok(existsSync(join(root, "src/app/api/stories/prepare/route.ts")));
  assert.ok(existsSync(join(root, "src/app/api/stories/client-upload/route.ts")));
  assert.ok(existsSync(join(root, "src/app/api/stories/finalize/route.ts")));
  const storiesLib = read("src/lib/stories.ts");
  assert.ok(/finalizeStoryFromBlob/.test(storiesLib));
  assert.ok(/StoryUploadError/.test(storiesLib));
  assert.ok(/probeRemoteMp4Duration|Range: "bytes=0-/.test(storiesLib));
}

{
  const vercel = read("vercel.json");
  assert.ok(/"schedule": "0 4 \* \* \*"/.test(vercel));
}

{
  // MIME helpers — inline mirror of resolveStoryMime
  function resolveStoryMime(opts) {
    const raw = (opts.mime || "").trim().toLowerCase();
    if (raw === "video/jpg") return "video/mp4";
    if (["video/mp4", "video/webm", "video/quicktime"].includes(raw)) return raw;
    const name = (opts.filename || "").toLowerCase();
    if (name.endsWith(".mov")) return "video/quicktime";
    if (name.endsWith(".webm")) return "video/webm";
    if (name.endsWith(".mp4") || name.endsWith(".m4v")) return "video/mp4";
    return raw || "";
  }
  assert.equal(resolveStoryMime({ mime: "video/quicktime" }), "video/quicktime");
  assert.equal(resolveStoryMime({ mime: "video/mp4" }), "video/mp4");
  assert.equal(resolveStoryMime({ mime: "", filename: "clip.MOV" }), "video/quicktime");
  assert.equal(resolveStoryMime({ mime: "", filename: "clip.mp4" }), "video/mp4");
  assert.equal(resolveStoryMime({ mime: "" }), "");
}

console.log("test-stories: ok");
