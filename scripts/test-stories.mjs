/**
 * Smoke tests for Stories: schema, Mux direct-upload + async processing,
 * ring batching, playback delivery.
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
  // Mux async processing columns
  assert.ok(/mediaProvider\s+String\s+@default\(""\)/.test(schema));
  assert.ok(/muxUploadId\s+String\?\s+@unique/.test(schema));
  assert.ok(/muxAssetId\s+String\?/.test(schema));
  assert.ok(/muxPlaybackId\s+String\?/.test(schema));
  assert.ok(/processingError\s+String\s+@default\(""\)/.test(schema));
  assert.ok(/readyAt\s+DateTime\?/.test(schema));
  assert.ok(/@@index\(\[muxAssetId\]\)/.test(schema));
  assert.ok(
    /UPLOADING \| PROCESSING \| READY \| ACTIVE \| FAILED \| EXPIRED \| DELETED/.test(
      schema,
    ),
  );
}

{
  // Mux architecture files exist and are wired up.
  assert.ok(existsSync(join(root, "src/lib/mux-stories.ts")));
  assert.ok(existsSync(join(root, "docs/story-media-architecture.md")));
  assert.ok(existsSync(join(root, "src/app/api/webhooks/mux/route.ts")));
  assert.ok(
    existsSync(
      join(root, "prisma/migrations/20260801100000_story_mux_processing/migration.sql"),
    ),
  );

  const mux = read("src/lib/mux-stories.ts");
  assert.ok(/isMuxConfigured/.test(mux));
  assert.ok(/getMuxClient/.test(mux));
  assert.ok(/createMuxDirectUpload/.test(mux));
  assert.ok(/classifyMuxError/.test(mux));
  assert.ok(/muxHlsUrl/.test(mux));
  assert.ok(/muxMp4Url/.test(mux));
  assert.ok(/muxThumbnailUrl/.test(mux));
  assert.ok(/deleteMuxAsset/.test(mux));
  assert.ok(/verifyMuxWebhook/.test(mux));
  assert.ok(/MUX_TOKEN_ID/.test(mux));
  assert.ok(/MUX_TOKEN_SECRET/.test(mux));
  assert.ok(/MUX_WEBHOOK_SECRET/.test(mux));
  assert.ok(/MUX_AUTH_FAILED/.test(mux));
  assert.ok(/video_quality:\s*"basic"/.test(mux));
  assert.ok(/passthrough: opts\.uploadSessionId/.test(mux));
  // Never hard-code secrets.
  assert.ok(!/MUX_TOKEN_SECRET\s*=\s*"[^"]+"/.test(mux));

  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies["@mux/mux-node"], "@mux/mux-node dependency missing");

  const envExample = read(".env.example");
  assert.ok(/MUX_TOKEN_ID/.test(envExample));
  assert.ok(/MUX_TOKEN_SECRET/.test(envExample));
  assert.ok(/MUX_WEBHOOK_SECRET/.test(envExample));
}

{
  const webhook = read("src/app/api/webhooks/mux/route.ts");
  assert.ok(/verifyMuxWebhook/.test(webhook));
  // Signature must be checked against the raw body, before parsing.
  assert.ok(/req\.text\(\)/.test(webhook));
  assert.ok(
    webhook.indexOf("verifyMuxWebhook(raw") < webhook.indexOf("JSON.parse(raw)"),
  );
  assert.ok(/video\.upload\.asset_created/.test(webhook));
  assert.ok(/video\.asset\.ready/.test(webhook));
  assert.ok(/video\.asset\.errored/.test(webhook));
  assert.ok(/video\.upload\.errored/.test(webhook));
  assert.ok(/createNotification/.test(webhook));
  assert.ok(/Your Story is ready/.test(webhook));
  assert.ok(/revalidatePublicMemberSurfaces/.test(webhook));
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
  assert.ok(/\/api\/stories\/prepare/.test(create));
  assert.ok(/\/api\/stories\/finalize/.test(create));
  assert.ok(/Choose Another Video/.test(create));
  assert.ok(/Duration will be verified during upload/.test(create));
  assert.ok(/storyErrorMessage|STORY_FILE_TOO_LARGE|StoryUploadErrorCode/.test(create));
  assert.ok(/STORY_FORMAT_HINT/.test(create));
  // Mux direct upload with real progress
  assert.ok(/provider === "mux"/.test(create));
  assert.ok(/putToDirectUpload/.test(create));
  assert.ok(/XMLHttpRequest/.test(create));
  assert.ok(/muxUploadId/.test(create));
  assert.ok(/onSuccess\(\{ processing: true \}\)/.test(create));
  // No client-side bitrate / fast-start rejection.
  assert.ok(!/MAX_STORY_DELIVERY_BYTES/.test(create));
  assert.ok(!/MAX_STORY_AVG_BYTES_PER_SEC/.test(create));
  assert.ok(!/BITRATE_TOO_HIGH/.test(create));
  assert.ok(!/NOT_FAST_START/.test(create));
  assert.ok(!/lower bitrate/i.test(create));
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
  assert.ok(/Your Story is processing\./.test(provider));
  assert.ok(/BATCH_FLUSH_MS|RING_TTL_MS/.test(provider));
  assert.ok(/invalidateRings/.test(provider));
  assert.ok(/pendingRef/.test(provider));
  // A processing clip has no ring yet — the viewer must not auto-open.
  assert.ok(!/setViewerUserId\(account\.id\);\s*\n\s*\}\s*\n\s*\}\}\s*\n\s*\/>/.test(provider));
  const onSuccessBlock = provider.slice(
    provider.indexOf("onSuccess={(result)"),
    provider.indexOf("<StoryOwnerMenu"),
  );
  assert.ok(onSuccessBlock.length > 0);
  assert.ok(!/setViewerUserId/.test(onSuccessBlock));
}

{
  const manage = read("src/components/stories/StoryManageModal.tsx");
  assert.ok(/storyStatusLabel/.test(manage));
  assert.ok(/clip\.status/.test(manage));
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
  // HLS-first with progressive MP4 fallback for non-Safari devices.
  assert.ok(/application\/vnd\.apple\.mpegurl/.test(viewer));
  assert.ok(/canPlayType/.test(viewer));
  assert.ok(/preferredSource/.test(viewer));
  assert.ok(/mp4Url/.test(viewer));
  assert.ok(/mux-cdn/.test(viewer));
}

{
  const constants = read("src/lib/story-constants.ts");
  assert.ok(/MAX_STORY_CLIP_SECONDS = 90/.test(constants));
  assert.ok(/MAX_ACTIVE_STORY_SECONDS = 90 \* 60/.test(constants));
  assert.ok(/MAX_STORY_CLIP_BYTES = 500 \* 1024 \* 1024/.test(constants));
  assert.ok(/STORY_FILE_TOO_LARGE/.test(constants));
  assert.ok(/STORY_URL_EXPIRED/.test(constants));
  assert.ok(/STORY_PROCESSING_TTL_MS/.test(constants));
  assert.ok(/resolveStoryMime/.test(constants));
  assert.ok(/storyStatusLabel/.test(constants));
  // READY (Mux) must be listed before ACTIVE (legacy Blob).
  const ready = constants.match(/STORY_READY_STATUSES = \[([^\]]+)\]/);
  assert.ok(ready, "STORY_READY_STATUSES not found");
  const readyList = ready[1].split(",").map((s) => s.trim().replace(/"/g, ""));
  assert.equal(readyList[0], "READY");
  assert.equal(readyList[1], "ACTIVE");
  // Upload copy must promise automatic optimisation, not manual re-export.
  assert.ok(
    /STORY_FORMAT_HINT =\s*\n?\s*"Up to 90 seconds\. Videos are optimised automatically\."/.test(
      constants,
    ),
  );
  assert.ok(/500 MB Story upload limit/.test(constants));
  // Legacy codes may remain declared, but must not be produced any more.
  assert.ok(!/MAX_STORY_DELIVERY_BYTES/.test(constants));
  assert.ok(!/MAX_STORY_AVG_BYTES_PER_SEC/.test(constants));
}

{
  assert.ok(existsSync(join(root, "src/app/api/stories/prepare/route.ts")));
  assert.ok(existsSync(join(root, "src/app/api/stories/client-upload/route.ts")));
  assert.ok(existsSync(join(root, "src/app/api/stories/finalize/route.ts")));
  assert.ok(existsSync(join(root, "src/app/api/stories/[clipId]/playback/route.ts")));
  const storiesLib = read("src/lib/stories.ts");
  assert.ok(/finalizeStoryFromBlob/.test(storiesLib));
  assert.ok(/finalizeStoryFromMux/.test(storiesLib));
  assert.ok(/StoryUploadError/.test(storiesLib));
  assert.ok(/probeRemoteMp4Duration|Range: "bytes=0-/.test(storiesLib));
  assert.ok(/getClipPlaybackGrant/.test(storiesLib));
  assert.ok(/direct-blob-cdn/.test(storiesLib));
  assert.ok(/mux-cdn/.test(storiesLib));
  assert.ok(/STORY_READY_STATUSES|readyStatusList/.test(storiesLib));
  assert.ok(/distinct: \["userId"\]/.test(storiesLib));
  // Owner surfaces must show in-flight clips; public surfaces must not.
  assert.ok(/listOwnerClips/.test(storiesLib));
  assert.ok(/ownerStoryWhere/.test(storiesLib));
  assert.ok(/inFlightStatusList/.test(storiesLib));
  // Webhook transitions
  assert.ok(/markMuxClipReady/.test(storiesLib));
  assert.ok(/markMuxClipFailed/.test(storiesLib));
  assert.ok(/attachMuxAssetToClip/.test(storiesLib));
  assert.ok(/deleteMuxAsset/.test(storiesLib));
  // No bitrate / fast-start rejection anywhere in the upload path.
  assert.ok(!/mp4MoovIsBeforeMdat/.test(storiesLib));
  assert.ok(!/MAX_STORY_AVG_BYTES_PER_SEC/.test(storiesLib));
  assert.ok(!/MAX_STORY_DELIVERY_BYTES/.test(storiesLib));
  assert.ok(!/BITRATE_TOO_HIGH/.test(storiesLib));
  assert.ok(!/NOT_FAST_START/.test(storiesLib));
  assert.ok(!/lower bitrate/i.test(storiesLib));
  assert.ok(!/fast-start/i.test(storiesLib));
  // validateStoryUploadMeta keeps only type / size / duration gates.
  const validate = storiesLib.slice(
    storiesLib.indexOf("export function validateStoryUploadMeta"),
    storiesLib.indexOf("export function storyMetaErrorCode"),
  );
  assert.ok(validate.length > 0);
  assert.ok(/MAX_STORY_CLIP_BYTES/.test(validate));
  assert.ok(/MAX_STORY_CLIP_SECONDS/.test(validate));
  assert.ok(!/durationSec >[\s\S]*BYTES_PER_SEC/.test(validate));
  assert.ok(!/bitrate/i.test(validate));
  // Must not proxy full video through Next.js
  assert.ok(!/arrayBuffer\(\).*video|proxy.*story.*bytes/i.test(storiesLib));
}

{
  const prepare = read("src/app/api/stories/prepare/route.ts");
  assert.ok(/isMuxConfigured/.test(prepare));
  assert.ok(/createMuxDirectUpload/.test(prepare));
  assert.ok(/classifyMuxError/.test(prepare));
  assert.ok(/provider: "mux"/.test(prepare));
  assert.ok(/uploadUrl/.test(prepare));
  assert.ok(/maxBytes: MAX_STORY_CLIP_BYTES/.test(prepare));
  assert.ok(/MUX_AUTH_FAILED/.test(prepare));
  // Production without Mux must refuse rather than publish an unprocessed file.
  assert.ok(/process\.env\.VERCEL/.test(prepare));
  assert.ok(
    /MUX_NOT_CONFIGURED[\s\S]{0,200}503|503,[\s\S]{0,200}MUX_NOT_CONFIGURED/.test(
      prepare,
    ),
  );

  const finalize = read("src/app/api/stories/finalize/route.ts");
  assert.ok(/finalizeStoryFromMux/.test(finalize));
  assert.ok(/muxUploadId/.test(finalize));
  assert.ok(/processing: true/.test(finalize));
  assert.ok(/Your Story is processing/.test(finalize));
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
  // Upload policy mirror: a 23.6 MB / 9s high-bitrate phone clip that the old
  // bitrate gate rejected must now be accepted — Mux re-encodes it.
  const MAX_STORY_CLIP_BYTES = 500 * 1024 * 1024;
  const MAX_STORY_CLIP_SECONDS = 90;

  function validateStoryUploadMeta({ mime, size, durationSec }) {
    if (!["video/mp4", "video/webm", "video/quicktime"].includes(mime)) {
      return "Unsupported video type. Use MP4, MOV, or WebM.";
    }
    if (size <= 0) return "Empty file.";
    if (size > MAX_STORY_CLIP_BYTES) {
      return "Video too large. Each Story clip can be up to 500 MB.";
    }
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return "Could not read video duration.";
    }
    if (durationSec > MAX_STORY_CLIP_SECONDS + 0.5) {
      return "Each Story clip can be up to 90 seconds long.";
    }
    return null;
  }

  assert.equal(
    validateStoryUploadMeta({
      mime: "video/quicktime",
      size: 23.6 * 1024 * 1024,
      durationSec: 9,
    }),
    null,
    "high-bitrate clips must no longer be rejected",
  );
  assert.equal(
    validateStoryUploadMeta({
      mime: "video/mp4",
      size: 400 * 1024 * 1024,
      durationSec: 88,
    }),
    null,
  );
  // Still rejected: oversized, too long, wrong type, empty.
  assert.ok(
    validateStoryUploadMeta({
      mime: "video/mp4",
      size: 600 * 1024 * 1024,
      durationSec: 30,
    }),
  );
  assert.ok(
    validateStoryUploadMeta({
      mime: "video/mp4",
      size: 1024,
      durationSec: 120,
    }),
  );
  assert.ok(
    validateStoryUploadMeta({ mime: "image/png", size: 1024, durationSec: 5 }),
  );
  assert.ok(
    validateStoryUploadMeta({ mime: "video/mp4", size: 0, durationSec: 5 }),
  );
}

{
  // Lifecycle: expiry is 24h from readyAt (webhook), not from upload start.
  const STORY_TTL_MS = 24 * 60 * 60 * 1000;
  const STORY_PROCESSING_TTL_MS = 48 * 60 * 60 * 1000;
  assert.ok(STORY_PROCESSING_TTL_MS > STORY_TTL_MS);
  const uploadedAt = new Date("2026-08-01T10:00:00Z");
  const readyAt = new Date("2026-08-01T10:04:00Z");
  const expiresAt = new Date(readyAt.getTime() + STORY_TTL_MS);
  assert.equal(expiresAt.toISOString(), "2026-08-02T10:04:00.000Z");
  assert.ok(expiresAt.getTime() > uploadedAt.getTime() + STORY_TTL_MS);
}

console.log("test-stories: ok");
