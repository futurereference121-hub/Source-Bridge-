/**
 * Automated checks for Story rings + player state machine
 * (mission sections 17–18).
 *
 * Mirrors `src/lib/story-player-state.ts` for behavioral asserts (no ts-node).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

// ---------------------------------------------------------------------------
// Mirror of story-player-state.ts (keep in sync)
// ---------------------------------------------------------------------------
const STORY_BUFFERING_DEBOUNCE_MS = 350;

function initialStoryPlayerState(phase = "idle") {
  return { phase, hasStartedPlayback: false, bufferingArmed: false };
}

function reduceStoryPlayer(state, event) {
  switch (event.type) {
    case "RESET":
    case "META_LOADING":
      return initialStoryPlayerState("loading");
    case "META_OK":
      if (!event.hasClips) return { ...initialStoryPlayerState("error") };
      return { ...initialStoryPlayerState("loading") };
    case "META_FAIL":
    case "ERROR":
      return {
        phase: "error",
        hasStartedPlayback: state.hasStartedPlayback,
        bufferingArmed: false,
      };
    case "CLIP_CHANGE":
    case "MEDIA_LOADING":
    case "RETRY":
      return initialStoryPlayerState("loading");
    case "CAN_PLAY":
      if (state.phase === "error" || state.phase === "tap_to_play") {
        return { ...state, bufferingArmed: false };
      }
      if (state.phase === "playing") {
        return { ...state, bufferingArmed: false };
      }
      if (state.phase === "buffering") {
        return {
          phase: state.hasStartedPlayback ? "playing" : "ready",
          hasStartedPlayback: state.hasStartedPlayback,
          bufferingArmed: false,
        };
      }
      return {
        phase: "ready",
        hasStartedPlayback: state.hasStartedPlayback,
        bufferingArmed: false,
      };
    case "PLAYING":
      return {
        phase: "playing",
        hasStartedPlayback: true,
        bufferingArmed: false,
      };
    case "WAITING":
    case "STALLED":
      if (
        state.phase === "error" ||
        state.phase === "tap_to_play" ||
        state.phase === "paused" ||
        state.phase === "ended" ||
        state.phase === "loading"
      ) {
        return state;
      }
      if (!state.hasStartedPlayback) return state;
      return { ...state, bufferingArmed: true };
    case "BUFFERING_CONFIRMED":
      if (!state.bufferingArmed || !state.hasStartedPlayback) {
        return { ...state, bufferingArmed: false };
      }
      if (
        state.phase === "playing" ||
        state.phase === "ready" ||
        state.phase === "buffering"
      ) {
        return {
          phase: "buffering",
          hasStartedPlayback: true,
          bufferingArmed: false,
        };
      }
      return { ...state, bufferingArmed: false };
    case "TIME_ADVANCED":
      if (state.phase === "buffering" || state.bufferingArmed) {
        return {
          phase: "playing",
          hasStartedPlayback: true,
          bufferingArmed: false,
        };
      }
      return state;
    case "PAUSE":
      return {
        phase: "paused",
        hasStartedPlayback: state.hasStartedPlayback,
        bufferingArmed: false,
      };
    case "AUTOPLAY_BLOCKED":
      return {
        phase: "tap_to_play",
        hasStartedPlayback: state.hasStartedPlayback,
        bufferingArmed: false,
      };
    case "ENDED":
      return {
        phase: "ended",
        hasStartedPlayback: state.hasStartedPlayback,
        bufferingArmed: false,
      };
    default:
      return state;
  }
}

function storyPlayerStatusLabel(phase) {
  switch (phase) {
    case "loading":
    case "idle":
      return "Loading Story…";
    case "buffering":
      return "Buffering…";
    case "tap_to_play":
      return "Tap to play";
    default:
      return null;
  }
}

function storyPlayerShowsStatusOverlay(phase) {
  return phase === "loading" || phase === "idle" || phase === "buffering";
}

// ---------------------------------------------------------------------------
// 17. Ring visibility architecture
// ---------------------------------------------------------------------------
{
  const avatar = read("src/components/stories/StoryAvatar.tsx");
  assert.ok(/data-story-ring/.test(avatar));
  assert.ok(/RING_PAD/.test(avatar));
  assert.ok(
    !/overflow-hidden rounded-xl bg-navy-mid \$\{ringClass\}/.test(avatar),
    "legacy overflow+ringClass combo must be gone",
  );
  assert.ok(/212,168,75/.test(avatar), "unseen ring should include gold glow");
  assert.ok(!/ring-electric\/35/.test(avatar), "seen ring must not be electric/35");

  const consumers = [
    "src/components/members/MemberCard.tsx",
    "src/components/explore/LiveFeed.tsx",
    "src/components/profile/FollowList.tsx",
    "src/components/layout/AccountMenu.tsx",
    "src/components/messaging/MessagesInbox.tsx",
  ];
  for (const file of consumers) {
    const src = read(file);
    assert.ok(
      !/StoryAvatar[\s\S]{0,220}ring-1 ring-white\/1[05]/.test(src),
      `${file} must not pass conflicting ring-1 to StoryAvatar`,
    );
  }

  const storiesLib = read("src/lib/stories.ts");
  const activeWhere = storiesLib.slice(
    storiesLib.indexOf("export function activeStoryWhere"),
    storiesLib.indexOf("export function ownerStoryWhere"),
  );
  assert.ok(/readyStatusList|STORY_READY_STATUSES/.test(activeWhere));
  assert.ok(/expiresAt:\s*\{\s*gt:\s*now\s*\}/.test(activeWhere));
  assert.ok(/deletedAt:\s*null/.test(activeWhere));

  const provider = read("src/components/stories/StoryProvider.tsx");
  assert.ok(/invalidateRings/.test(provider));
  assert.ok(/RING_TTL_MS\s*=\s*12_000/.test(provider));
  assert.ok(/visibilitychange/.test(provider));
  assert.ok(/OWNER_READY_POLL/.test(provider));

  // Source module must export the same debounce window the mirror uses.
  const stateSrc = read("src/lib/story-player-state.ts");
  assert.ok(
    new RegExp(
      `STORY_BUFFERING_DEBOUNCE_MS\\s*=\\s*${STORY_BUFFERING_DEBOUNCE_MS}`,
    ).test(stateSrc),
  );
  assert.ok(/export function reduceStoryPlayer/.test(stateSrc));
  assert.ok(/BUFFERING_CONFIRMED/.test(stateSrc));
  assert.ok(/AUTOPLAY_BLOCKED/.test(stateSrc));
}

// ---------------------------------------------------------------------------
// 18. Player state machine behavior
// ---------------------------------------------------------------------------
{
  assert.ok(STORY_BUFFERING_DEBOUNCE_MS >= 250);
  assert.ok(STORY_BUFFERING_DEBOUNCE_MS <= 500);

  let s = initialStoryPlayerState("idle");
  s = reduceStoryPlayer(s, { type: "META_LOADING" });
  assert.equal(s.phase, "loading");
  assert.equal(storyPlayerStatusLabel(s.phase), "Loading Story…");
  assert.equal(storyPlayerShowsStatusOverlay(s.phase), true);

  s = reduceStoryPlayer(s, { type: "META_OK", hasClips: true });
  assert.equal(s.phase, "loading");

  s = reduceStoryPlayer(s, { type: "CLIP_CHANGE" });
  assert.equal(s.phase, "loading");
  assert.equal(s.hasStartedPlayback, false);

  s = reduceStoryPlayer(s, { type: "WAITING" });
  assert.equal(s.bufferingArmed, false);
  assert.equal(s.phase, "loading");

  s = reduceStoryPlayer(s, { type: "CAN_PLAY" });
  assert.equal(s.phase, "ready");

  s = reduceStoryPlayer(s, { type: "PLAYING" });
  assert.equal(s.phase, "playing");
  assert.equal(s.hasStartedPlayback, true);
  assert.equal(storyPlayerShowsStatusOverlay(s.phase), false);

  s = reduceStoryPlayer(s, { type: "WAITING" });
  assert.equal(s.bufferingArmed, true);
  assert.equal(s.phase, "playing");
  s = reduceStoryPlayer(s, { type: "BUFFERING_CONFIRMED" });
  assert.equal(s.phase, "buffering");
  assert.equal(storyPlayerStatusLabel(s.phase), "Buffering…");

  s = reduceStoryPlayer(s, { type: "TIME_ADVANCED" });
  assert.equal(s.phase, "playing");
  assert.equal(s.bufferingArmed, false);

  s = reduceStoryPlayer(s, { type: "AUTOPLAY_BLOCKED" });
  assert.equal(s.phase, "tap_to_play");
  assert.equal(storyPlayerStatusLabel(s.phase), "Tap to play");
  assert.equal(storyPlayerShowsStatusOverlay(s.phase), false);

  s = reduceStoryPlayer(s, { type: "CLIP_CHANGE" });
  assert.equal(s.phase, "loading");
  assert.equal(s.hasStartedPlayback, false);

  s = reduceStoryPlayer(s, { type: "META_OK", hasClips: false });
  assert.equal(s.phase, "error");
}

{
  const viewer = read("src/components/stories/StoryViewer.tsx");
  assert.ok(/from "hls\.js"/.test(viewer));
  assert.ok(/Hls\.isSupported/.test(viewer));
  assert.ok(/STORY_BUFFERING_DEBOUNCE_MS|BUFFERING_CONFIRMED/.test(viewer));
  assert.ok(/reduceStoryPlayer/.test(viewer));
  assert.ok(/AUTOPLAY_BLOCKED/.test(viewer));
  assert.ok(/capLevelToPlayerSize:\s*true/.test(viewer));
  assert.ok(/useHlsJs/.test(viewer));
  assert.ok(/showStatus && statusLabel/.test(viewer));
  assert.ok(/\[story-playback\]/.test(viewer));
}

{
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies["hls.js"], "hls.js must be a dependency");
}

console.log("test-story-ring-playback: ok");
