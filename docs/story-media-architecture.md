# Story media architecture

## Selected approach: Mux Video

**Why Mux (not FFmpeg-on-Vercel, MediaConvert, or Blob-only):**

- Vercel serverless requests are short-lived and memory-limited — in-request FFmpeg cannot reliably transcode 90s phone camera originals.
- Mux provides **direct upload** (short-lived URL, no permanent client credentials), **async transcode**, **HLS ABR**, **MP4 H.264/AAC**, **thumbnails**, **CDN**, and **signed webhooks**.
- Fits the existing Vercel + Neon stack: only API keys as env vars; no worker fleet.
- Cloudflare Stream is a close alternative; Mux’s Node SDK + webhook verification is the better fit here.
- AWS MediaConvert would work but needs S3 + IAM + job orchestration — heavier for this app.

## Upload vs delivery

| Stage | What | Visibility |
|-------|------|------------|
| UPLOADING | Client PUTs original to Mux direct-upload URL | Owner only |
| PROCESSING | Clip row exists; Mux is transcoding | Owner (“processing”); **no public ring** |
| READY | Processed HLS + MP4 playback IDs | Public ring + viewer |
| FAILED | Undecodable / over duration / Mux error | Owner; no ring |
| EXPIRED / DELETED | Cleanup deletes Mux asset | Gone |

**Expiry:** 24 hours after `readyAt` (not upload time). Documented in code as `STORY_TTL_MS` applied when the webhook marks READY.

**Originals:** Not stored on Vercel Blob when Mux is used. Mux ingest is ephemeral; after success we keep only delivery assets (`muxPlaybackId`). On expire/delete we delete the Mux asset. Legacy Blob `ACTIVE` clips (pre-Mux) remain playable until natural expiry — **not bulk-deleted**.

## Limits

- Duration: 90 seconds (enforced client + Mux duration on ready)
- Upload size: **500 MB** (`MAX_STORY_CLIP_BYTES`) — practical for ≤90s mobile camera files
- Reject only: corrupt/empty, wrong type, >90s, >500 MB, quota, auth — **not** bitrate / fast-start

## Request flow

1. `POST /api/stories/prepare` — auth + type/size gate, then `uploads.create` on Mux.
   Returns `{ provider: "mux", uploadUrl, uploadId, uploadSessionId, contentType, maxBytes }`.
   The upload URL is short-lived and single-use; no Mux credentials reach the browser.
2. Browser `PUT`s the original file straight to `uploadUrl` (XHR, real progress).
   Bytes never pass through a Next.js request body.
3. `POST /api/stories/finalize` — creates the `StoryClip` row as `PROCESSING`
   (`mediaProvider: "mux"`, `videoUrl: ""`, provisional `expiresAt = now + STORY_PROCESSING_TTL_MS`).
   Idempotent on `uploadSessionId`.
4. `POST /api/webhooks/mux` — signature-verified against the **raw** body:
   - `video.upload.asset_created` → store `muxAssetId`
   - `video.asset.ready` → `READY`, `muxPlaybackId`, `videoUrl` = HLS, thumbnail,
     duration **from Mux**, `readyAt = now`, `expiresAt = readyAt + 24h`,
     owner notification + public revalidation
   - `video.asset.errored` / `video.upload.errored` → `FAILED` (+ asset deleted)

   Every handler is idempotent because Mux retries. Playback URLs are always
   derived from the verified payload — a client can never supply a media URL.

## Delivery

| Provider | Grant `delivery` | Sources |
|----------|------------------|---------|
| Mux | `mux-cdn` | HLS `.m3u8` (preferred where `canPlayType('application/vnd.apple.mpegurl')`), progressive `highest.mp4` fallback |
| Legacy Blob | `direct-blob-cdn` | Public Blob URL |

`getClipPlaybackGrant` only returns clips matching `activeStoryWhere`
(`READY`/`ACTIVE`, not deleted, unexpired), so `PROCESSING` and `FAILED` clips
are never playable.

## What is *not* rejected any more

Bitrate ceilings, average bytes/second limits and MP4 `moov`/fast-start ordering
are **no longer upload blockers** — Mux re-encodes everything it accepts, so a
high-bitrate HEVC phone original is fine. `STORY_BITRATE_TOO_HIGH` and
`STORY_NOT_FAST_START` remain defined but unused.

Rejected: empty/corrupt, unsupported type, longer than 90s, larger than 500 MB,
over the 90-minute allowance, unauthenticated/admin, or undecodable (surfaced
asynchronously by Mux as `FAILED`).

## Env vars (names only)

- `MUX_TOKEN_ID` — Mux Access Token **ID** (not a placeholder; typically longer than a short label)
- `MUX_TOKEN_SECRET` — matching Access Token **Secret** from the same token
- `MUX_WEBHOOK_SECRET` — signing secret for `https://www.sourcebridge.app/api/webhooks/mux`
- `APP_URL` (CORS origin for direct uploads)

If prepare returns `STORY_MUX_AUTH_FAILED` (HTTP 502), Production credentials were rejected by Mux (`401 Unauthorized`). Re-create the Access Token in the Mux dashboard (Video + Direct Uploads), update both ID and Secret in Vercel Production, and redeploy. Do not paste secrets into git or chat.

Known failure mapping for request reference `358b8e0d0876` (2026-08): prepare → `uploads.create` → Mux `401 unauthorized` → previously collapsed to `STORY_UNKNOWN`; now returns `STORY_MUX_AUTH_FAILED`.

Without `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET`, production (`process.env.VERCEL`)
returns `503 STORY_STORAGE_FAILED` from prepare/finalize rather than publishing an
unprocessed original. Local development without Mux falls back to the small
direct-to-Blob path.

## Migration of existing clips

Additive migration only (`20260801100000_story_mux_processing`). Existing
`ACTIVE` Blob clips are **not** deleted or backfilled to Mux — they stay
playable through `direct-blob-cdn` until their natural 24-hour expiry. All new
uploads take the `PROCESSING → READY` Mux path.
