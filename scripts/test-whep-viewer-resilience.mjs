/**
 * WHEP viewer resilience — pure state machine + policy + contract tests.
 * Run via: npx tsx scripts/test-whep-viewer-resilience.mjs
 * (also invoked from test-live-streaming.mjs)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const {
  WHEP_MAX_AUTO_RETRIES,
  WHEP_ICE_DISCONNECT_GRACE_MS,
  WHEP_TRACK_MUTE_GRACE_MS,
  WHEP_RENDER_STALL_MS,
  WHEP_BACKOFF_BASE_MS,
  WHEP_BACKOFF_MAX_MS,
  WHEP_RECONNECT_MESSAGE,
  WHEP_FAILED_MESSAGE,
  whepBackoffMs,
  tokenRefreshDelayMs,
  shouldRefreshTokenSoon,
} = await import("../src/lib/live/whep-viewer-policy.ts");

const {
  initialWhepViewerState,
  reduceWhepViewer,
  canAutoReconnect,
  isCaptureAllowed,
  isPlaybackHealthy,
} = await import("../src/lib/live/whep-viewer-state.ts");

console.log("=== WHEP policy thresholds ===");
assert.ok(WHEP_ICE_DISCONNECT_GRACE_MS >= 1500);
assert.ok(WHEP_TRACK_MUTE_GRACE_MS >= 1000);
assert.ok(WHEP_RENDER_STALL_MS >= 3000);
assert.equal(WHEP_MAX_AUTO_RETRIES, 5);
assert.ok(WHEP_BACKOFF_BASE_MS >= 500);
assert.ok(WHEP_BACKOFF_MAX_MS >= WHEP_BACKOFF_BASE_MS);
assert.equal(WHEP_RECONNECT_MESSAGE, "Reconnecting…");
assert.match(WHEP_FAILED_MESSAGE, /Unable to reconnect/);

{
  const d0 = whepBackoffMs(0, () => 0);
  const d3 = whepBackoffMs(3, () => 0);
  assert.ok(d0 >= WHEP_BACKOFF_BASE_MS);
  assert.ok(d3 > d0);
  assert.ok(whepBackoffMs(20, () => 0) <= WHEP_BACKOFF_MAX_MS * 1.3);
}

{
  const now = 1_700_000_000_000;
  const exp = Math.floor((now + 60_000) / 1000);
  assert.equal(shouldRefreshTokenSoon(exp, now, 10_000), false);
  assert.equal(shouldRefreshTokenSoon(exp, now + 55_000, 10_000), true);
  assert.ok(tokenRefreshDelayMs(exp, now) >= 5_000);
}

console.log("=== WHEP state machine ===");

{
  let s = initialWhepViewerState();
  s = reduceWhepViewer(s, { type: "START" });
  assert.equal(s.phase, "connecting");
  assert.equal(s.generation, 1);
  assert.equal(isCaptureAllowed(s), false);

  s = reduceWhepViewer(s, { type: "TRACK", kind: "video" });
  s = reduceWhepViewer(s, { type: "TRACK", kind: "audio" });
  assert.equal(s.hasVideoTrack, true);
  assert.equal(s.hasAudioTrack, true);

  s = reduceWhepViewer(s, { type: "PLAYING" });
  assert.equal(s.phase, "playing");
  assert.equal(isCaptureAllowed(s), true);
  assert.equal(isPlaybackHealthy(s), true);
}

{
  // Transient interrupt → recover without rebuild counter bump
  let s = initialWhepViewerState();
  s = reduceWhepViewer(s, { type: "START" });
  s = reduceWhepViewer(s, { type: "TRACK", kind: "video" });
  s = reduceWhepViewer(s, { type: "PLAYING" });
  s = reduceWhepViewer(s, { type: "INTERRUPT", reason: "track_mute" });
  assert.equal(s.phase, "interrupted");
  assert.equal(isCaptureAllowed(s), false);
  assert.equal(s.retryCount, 0);
  s = reduceWhepViewer(s, { type: "RECOVERED" });
  assert.equal(s.phase, "playing");
  assert.equal(s.retryCount, 0);
}

{
  // ICE/PC failure rebuild + generation bump; stale gen must be higher
  let s = initialWhepViewerState();
  s = reduceWhepViewer(s, { type: "START" });
  const g1 = s.generation;
  s = reduceWhepViewer(s, { type: "PLAYING" });
  s = reduceWhepViewer(s, { type: "RECONNECT", reason: "ice_failed" });
  assert.equal(s.phase, "reconnecting");
  assert.ok(s.generation > g1);
  assert.equal(s.retryCount, 1);
  assert.equal(s.hasVideoTrack, false);
  assert.equal(isCaptureAllowed(s), false);
  s = reduceWhepViewer(s, { type: "TRACK", kind: "video" });
  s = reduceWhepViewer(s, { type: "RECONNECT_OK" });
  assert.equal(s.phase, "playing");
}

{
  // Only one logical reconnect path increments retries; exhaust → failed
  let s = initialWhepViewerState();
  s = reduceWhepViewer(s, { type: "START" });
  for (let i = 0; i < WHEP_MAX_AUTO_RETRIES; i++) {
    s = reduceWhepViewer(s, { type: "RECONNECT", reason: "render_stall" });
    assert.equal(s.phase, "reconnecting");
  }
  assert.equal(s.retryCount, WHEP_MAX_AUTO_RETRIES);
  assert.equal(canAutoReconnect(s), false);
  s = reduceWhepViewer(s, { type: "RECONNECT", reason: "render_stall" });
  assert.equal(s.phase, "failed");
  assert.equal(isCaptureAllowed(s), false);

  // Manual retry clears failure
  s = reduceWhepViewer(s, { type: "MANUAL_RETRY" });
  assert.equal(s.phase, "reconnecting");
  assert.equal(s.retryCount, 0);
}

{
  // Authoritative end stops retrying
  let s = initialWhepViewerState();
  s = reduceWhepViewer(s, { type: "START" });
  s = reduceWhepViewer(s, { type: "PLAYING" });
  s = reduceWhepViewer(s, { type: "ENDED" });
  assert.equal(s.phase, "ended");
  const after = reduceWhepViewer(s, { type: "RECONNECT", reason: "ice_failed" });
  assert.equal(after.phase, "ended");
  assert.equal(after.generation, s.generation);
}

{
  // Autoplay blocked — no capture, clear user control path
  let s = initialWhepViewerState();
  s = reduceWhepViewer(s, { type: "START" });
  s = reduceWhepViewer(s, { type: "TRACK", kind: "video" });
  s = reduceWhepViewer(s, { type: "AUTOPLAY_BLOCKED" });
  assert.equal(s.phase, "autoplay_blocked");
  assert.equal(isCaptureAllowed(s), false);
  s = reduceWhepViewer(s, { type: "USER_PLAY" });
  assert.equal(s.phase, "playing");
}

{
  // Offline interrupt
  let s = initialWhepViewerState();
  s = reduceWhepViewer(s, { type: "START" });
  s = reduceWhepViewer(s, { type: "PLAYING" });
  s = reduceWhepViewer(s, { type: "OFFLINE" });
  assert.equal(s.phase, "interrupted");
  assert.equal(s.lastReason, "offline");
}

{
  // Reset retries after stable playback
  let s = initialWhepViewerState();
  s = reduceWhepViewer(s, { type: "START" });
  s = reduceWhepViewer(s, { type: "RECONNECT", reason: "pc_failed" });
  assert.equal(s.retryCount, 1);
  s = reduceWhepViewer(s, { type: "RESET_RETRIES" });
  assert.equal(s.retryCount, 0);
}

{
  // Stale generation protection: bump then compare
  let s = initialWhepViewerState();
  s = reduceWhepViewer(s, { type: "START" });
  const staleGen = s.generation;
  s = reduceWhepViewer(s, { type: "BUMP_GENERATION" });
  assert.ok(s.generation > staleGen);
}

console.log("=== WHEP player contracts ===");
{
  const player = read("src/components/live/LivePlayer.tsx");
  assert.match(player, /WhepViewerSession/);
  assert.match(player, /WHEP_RECONNECT_MESSAGE|Reconnecting/);
  assert.doesNotMatch(player, /Broadcaster reconnecting/);
  assert.doesNotMatch(player, /hls\.js/);
  assert.match(player, /Capture Item/);
  assert.match(player, /Picture not available/);
  assert.match(player, /setGrant\(next\)/);
  assert.match(player, /tokenRefreshDelayMs/);
  assert.doesNotMatch(player, /Jump to Live/);
  assert.doesNotMatch(player, /cloudflarestream\.com/);
}

{
  const session = read("src/components/live/whep-viewer-session.ts");
  assert.match(session, /generation/);
  assert.match(session, /isCurrent\(gen\)/);
  assert.match(session, /fetchGrant/);
  assert.match(session, /AbortController/);
  assert.match(session, /visibilitychange/);
  assert.match(session, /pageshow/);
  assert.match(session, /online/);
  assert.match(session, /offline/);
  assert.match(session, /requestVideoFrameCallback/);
  assert.match(session, /WHEP_RENDER_STALL_MS/);
  assert.match(session, /track_mute/);
  assert.match(session, /Fresh auth on every rebuild/);
  assert.doesNotMatch(session, /console\.log\(.*sdp/i);
  assert.doesNotMatch(session, /whepUrl.*console/);
}

{
  const whip = read("src/components/live/whip.ts");
  assert.match(whip, /addTransceiver\("video", \{ direction: "recvonly" \}/);
  assert.match(whip, /stream\.addTrack/);
  assert.match(whip, /signal\?: AbortSignal/);
  assert.match(whip, /stopWhepPlayback/);
  assert.match(whip, /ontrack = null/);
}

{
  const watch = read("src/app/api/live/sessions/[id]/watch/route.ts");
  assert.match(watch, /requireSessionUser/);
  assert.match(watch, /issueLiveWatchGrant/);
  // Crypto/provider failures are mapped to the safe public message.
  assert.match(watch, /LIVE_WATCH_UNAVAILABLE_MESSAGE/);
  assert.match(watch, /DECODER routines/);
}

{
  // Soft token refresh must not depend on grant object identity remounting WHEP
  const player = read("src/components/live/LivePlayer.tsx");
  assert.match(player, /Do NOT destroy a healthy WHEP/);
  assert.match(player, /sessionRef\.current\?\.setGrant/);
}

{
  // No payment-frozen touch in new Live viewer modules
  for (const rel of [
    "src/lib/live/whep-viewer-policy.ts",
    "src/lib/live/whep-viewer-state.ts",
    "src/components/live/whep-viewer-session.ts",
  ]) {
    const src = read(rel);
    assert.doesNotMatch(src, /ProtectedTransaction|PaymentIntent|SOURCE_BRIDGE_FEE/);
    assert.doesNotMatch(src, /stripe\./i);
  }
}

console.log("[test-whep-viewer-resilience] passed");
