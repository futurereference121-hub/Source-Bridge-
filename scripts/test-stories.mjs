/**
 * Smoke tests for Stories: schema, direct-to-Blob flow, ring batching, playback.
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
  assert.ok(/@@index\(\[userId, status, expiresAt\]\)/.test(schema));
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
  assert.ok(/MAX_STORY_DELIVERY_BYTES|BITRATE_TOO_HIGH|MAX_STORY_AVG_BYTES_PER_SEC/.test(create));
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
  assert.ok(/BATCH_FLUSH_MS|RING_TTL_MS/.test(provider));
  assert.ok(/invalidateRings/.test(provider));
  assert.ok(/pendingRef/.test(provider));
}

{
  const memberCard = read("src/components/members/MemberCard.tsx");
  assert.ok(!/refreshRings\(\[member\.id\]\)/.test(memberCard));
}

{
  const explorer = read("src/app/explore/ExploreClient.tsx");
  assert.ok(/stories\?\.refreshRings\(ids\)/.test(explorer));
  assert.ok(/stories\?\.refreshRings/.test(explorer));
}

{
  const viewer = read("src/components/stories/StoryViewer.tsx");
  assert.ok(/playsInline/.test(viewer));
  assert.ok(/Tap to play/.test(viewer));
  assert.ok(/STORY_URL_EXPIRED|StoryPlaybackErrorCode/.test(viewer));
  assert.ok(/onPlaying/.test(viewer));
  assert.ok(/\/api\/stories\/\$\{clipId\}\/playback|\/playback/.test(viewer));
  assert.ok(/Buffering/.test(viewer));
  assert.ok(/\[story-playback\]/.test(viewer));
}

{
  const constants = read("src/lib/story-constants.ts");
  assert.ok(/MAX_STORY_CLIP_SECONDS = 90/.test(constants));
  assert.ok(/MAX_ACTIVE_STORY_SECONDS = 90 \* 60/.test(constants));
  assert.ok(/MAX_STORY_CLIP_BYTES = 100/.test(constants));
  assert.ok(/STORY_FILE_TOO_LARGE/.test(constants));
  assert.ok(/STORY_BITRATE_TOO_HIGH/.test(constants));
  assert.ok(/STORY_URL_EXPIRED/.test(constants));
  assert.ok(/STORY_READY_STATUSES/.test(constants));
  assert.ok(/resolveStoryMime/.test(constants));
  assert.ok(/MAX_STORY_DELIVERY_BYTES/.test(constants));
}

{
  assert.ok(existsSync(join(root, "src/app/api/stories/prepare/route.ts")));
  assert.ok(existsSync(join(root, "src/app/api/stories/client-upload/route.ts")));
  assert.ok(existsSync(join(root, "src/app/api/stories/finalize/route.ts")));
  assert.ok(existsSync(join(root, "src/app/api/stories/[clipId]/playback/route.ts")));
  const storiesLib = read("src/lib/stories.ts");
  assert.ok(/finalizeStoryFromBlob/.test(storiesLib));
  assert.ok(/StoryUploadError/.test(storiesLib));
  assert.ok(/probeRemoteMp4Duration|Range: "bytes=0-/.test(storiesLib));
  assert.ok(/mp4MoovIsBeforeMdat/.test(storiesLib));
  assert.ok(/getClipPlaybackGrant/.test(storiesLib));
  assert.ok(/direct-blob-cdn/.test(storiesLib));
  assert.ok(/STORY_READY_STATUSES|readyStatusList/.test(storiesLib));
  assert.ok(/distinct: \["userId"\]/.test(storiesLib));
  // Must not proxy full video through Next.js
  assert.ok(!/arrayBuffer\(\).*video|proxy.*story.*bytes/i.test(storiesLib));
}

{
  const playback = read("src/app/api/stories/[clipId]/playback/route.ts");
  assert.ok(/getClipPlaybackGrant/.test(playback));
  assert.ok(/never proxies video|direct-blob|Blob\/CDN/i.test(playback));
}

{
  const rings = read("src/app/api/stories/rings/route.ts");
  assert.ok(/Cache-Control/.test(rings));
  assert.ok(/getStoryRingStates/.test(rings));
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

{
  // Bitrate policy mirror
  const MAX_STORY_AVG_BYTES_PER_SEC = 750_000;
  const MAX_STORY_DELIVERY_BYTES = 12 * 1024 * 1024;
  const huge = 23.6 * 1024 * 1024;
  const dur = 9;
  assert.ok(huge > MAX_STORY_DELIVERY_BYTES);
  assert.ok(huge / dur > MAX_STORY_AVG_BYTES_PER_SEC);
  const okSize = 2 * 1024 * 1024;
  assert.ok(okSize / 5 < MAX_STORY_AVG_BYTES_PER_SEC);
}

{
  // Fast-start atom order helpers (minimal ftyp+moov+mdat vs ftyp+mdat)
  function mp4MoovIsBeforeMdat(buffer) {
    const len = buffer.length;
    let offset = 0;
    let sawMoov = false;
    let sawMdat = false;
    while (offset + 8 <= len) {
      let size = buffer.readUInt32BE(offset);
      const type = buffer.toString("ascii", offset + 4, offset + 8);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > len) break;
        size = Number(buffer.readBigUInt64BE(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = len - offset;
      }
      if (size < header) return null;
      if (type === "moov") {
        if (sawMdat) return false;
        sawMoov = true;
        return true;
      }
      if (type === "mdat") {
        if (sawMoov) return true;
        sawMdat = true;
      }
      offset += size;
    }
    if (sawMdat && !sawMoov) return false;
    if (sawMoov) return true;
    return null;
  }

  function box(type, payload) {
    const size = 8 + payload.length;
    const buf = Buffer.alloc(size);
    buf.writeUInt32BE(size, 0);
    buf.write(type, 4, 4, "ascii");
    payload.copy(buf, 8);
    return buf;
  }

  const fast = Buffer.concat([
    box("ftyp", Buffer.from("isom")),
    box("moov", Buffer.from("x")),
    box("mdat", Buffer.from("yyyy")),
  ]);
  const slow = Buffer.concat([
    box("ftyp", Buffer.from("isom")),
    box("mdat", Buffer.from("yyyy")),
    box("moov", Buffer.from("x")),
  ]);
  assert.equal(mp4MoovIsBeforeMdat(fast), true);
  assert.equal(mp4MoovIsBeforeMdat(slow), false);
}

console.log("test-stories: ok");
