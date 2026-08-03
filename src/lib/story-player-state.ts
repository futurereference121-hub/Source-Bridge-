/**
 * Story viewer playback phase machine.
 * Pure helpers — unit-tested without DOM / Mux URLs.
 */

export type StoryPlayerPhase =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "buffering"
  | "paused"
  | "ended"
  | "error"
  | "tap_to_play";

/** Delay before surfacing "Buffering…" after a genuine wait/stall. */
export const STORY_BUFFERING_DEBOUNCE_MS = 350;

export type StoryPlayerEvent =
  | { type: "RESET" }
  | { type: "META_LOADING" }
  | { type: "META_OK"; hasClips: boolean }
  | { type: "META_FAIL" }
  | { type: "CLIP_CHANGE" }
  | { type: "MEDIA_LOADING" }
  | { type: "CAN_PLAY" }
  | { type: "PLAYING" }
  | { type: "WAITING" }
  | { type: "STALLED" }
  | { type: "TIME_ADVANCED" }
  | { type: "BUFFERING_CONFIRMED" }
  | { type: "PAUSE" }
  | { type: "AUTOPLAY_BLOCKED" }
  | { type: "ENDED" }
  | { type: "ERROR" }
  | { type: "RETRY" };

export type StoryPlayerState = {
  phase: StoryPlayerPhase;
  /** True once playback has successfully started for the current clip. */
  hasStartedPlayback: boolean;
  /** Waiting/stalled arming a debounced BUFFERING transition. */
  bufferingArmed: boolean;
};

export function initialStoryPlayerState(
  phase: StoryPlayerPhase = "idle",
): StoryPlayerState {
  return {
    phase,
    hasStartedPlayback: false,
    bufferingArmed: false,
  };
}

/**
 * Reduce a playback event. Debounce is external — WAITING/STALLED only arm;
 * BUFFERING_CONFIRMED commits after the timer.
 */
export function reduceStoryPlayer(
  state: StoryPlayerState,
  event: StoryPlayerEvent,
): StoryPlayerState {
  switch (event.type) {
    case "RESET":
    case "META_LOADING":
      return initialStoryPlayerState("loading");
    case "META_OK":
      if (!event.hasClips) {
        return { ...initialStoryPlayerState("error") };
      }
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
      // Only arm debounce after playback has actually started.
      if (!state.hasStartedPlayback) {
        return state;
      }
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

/** Status copy for overlays — null when no overlay should mount. */
export function storyPlayerStatusLabel(
  phase: StoryPlayerPhase,
): string | null {
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

/** Whether a blocking status overlay should be mounted (pointer-events none). */
export function storyPlayerShowsStatusOverlay(
  phase: StoryPlayerPhase,
): boolean {
  return phase === "loading" || phase === "idle" || phase === "buffering";
}
