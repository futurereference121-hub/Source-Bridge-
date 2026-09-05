/**
 * Pure WHEP viewer playback state machine.
 * Browser session controller applies side effects; this module stays deterministic.
 */

import { WHEP_MAX_AUTO_RETRIES } from "./whep-viewer-policy";

export type WhepViewerPhase =
  | "idle"
  | "connecting"
  | "playing"
  | "interrupted"
  | "reconnecting"
  | "autoplay_blocked"
  | "failed"
  | "ended";

export type WhepViewerState = {
  phase: WhepViewerPhase;
  generation: number;
  retryCount: number;
  hasVideoTrack: boolean;
  hasAudioTrack: boolean;
  lastReason: string | null;
  captureAvailable: boolean;
  showReconnectingUi: boolean;
};

export type WhepViewerEvent =
  | { type: "START" }
  | { type: "NEGOTIATED" }
  | { type: "TRACK"; kind: "video" | "audio" }
  | { type: "PLAYING" }
  | { type: "FRAME_OK" }
  | { type: "INTERRUPT"; reason: string }
  | { type: "RECOVERED" }
  | { type: "RECONNECT"; reason: string }
  | { type: "RECONNECT_OK" }
  | { type: "RETRY_EXHAUSTED"; reason: string }
  | { type: "AUTOPLAY_BLOCKED" }
  | { type: "USER_PLAY" }
  | { type: "OFFLINE" }
  | { type: "MANUAL_RETRY" }
  | { type: "ENDED" }
  | { type: "BUMP_GENERATION" }
  | { type: "RESET_RETRIES" }
  | { type: "SHOW_RECONNECT_UI" }
  | { type: "HIDE_RECONNECT_UI" };

export function initialWhepViewerState(): WhepViewerState {
  return {
    phase: "idle",
    generation: 0,
    retryCount: 0,
    hasVideoTrack: false,
    hasAudioTrack: false,
    lastReason: null,
    captureAvailable: false,
    showReconnectingUi: false,
  };
}

function playingCapture(state: WhepViewerState): boolean {
  return state.hasVideoTrack && state.phase === "playing";
}

export function reduceWhepViewer(
  state: WhepViewerState,
  event: WhepViewerEvent,
): WhepViewerState {
  if (state.phase === "ended" && event.type !== "START") {
    return state;
  }

  switch (event.type) {
    case "START":
      return {
        ...initialWhepViewerState(),
        phase: "connecting",
        generation: state.generation + 1,
        lastReason: "initial",
      };
    case "BUMP_GENERATION":
      return { ...state, generation: state.generation + 1 };
    case "NEGOTIATED":
      if (state.phase === "ended" || state.phase === "failed") return state;
      return {
        ...state,
        phase: state.phase === "reconnecting" ? "reconnecting" : "connecting",
      };
    case "TRACK":
      return {
        ...state,
        hasVideoTrack: event.kind === "video" ? true : state.hasVideoTrack,
        hasAudioTrack: event.kind === "audio" ? true : state.hasAudioTrack,
      };
    case "PLAYING":
    case "FRAME_OK":
    case "RECOVERED":
    case "RECONNECT_OK": {
      if (state.phase === "ended") return state;
      const next: WhepViewerState = {
        ...state,
        phase: "playing",
        showReconnectingUi: false,
        lastReason: null,
        captureAvailable: state.hasVideoTrack,
      };
      return next;
    }
    case "INTERRUPT":
      if (
        state.phase === "ended" ||
        state.phase === "failed" ||
        state.phase === "reconnecting" ||
        state.phase === "connecting"
      ) {
        return { ...state, lastReason: event.reason, captureAvailable: false };
      }
      return {
        ...state,
        phase: "interrupted",
        lastReason: event.reason,
        captureAvailable: false,
      };
    case "RECONNECT": {
      if (state.phase === "ended") return state;
      if (state.retryCount >= WHEP_MAX_AUTO_RETRIES && event.reason !== "manual_retry") {
        return {
          ...state,
          phase: "failed",
          lastReason: event.reason,
          captureAvailable: false,
          showReconnectingUi: false,
        };
      }
      return {
        ...state,
        phase: "reconnecting",
        generation: state.generation + 1,
        retryCount:
          event.reason === "manual_retry"
            ? 0
            : event.reason === "initial"
              ? state.retryCount
              : state.retryCount + 1,
        lastReason: event.reason,
        hasVideoTrack: false,
        hasAudioTrack: false,
        captureAvailable: false,
        showReconnectingUi: true,
      };
    }
    case "RETRY_EXHAUSTED":
      return {
        ...state,
        phase: "failed",
        lastReason: event.reason,
        captureAvailable: false,
        showReconnectingUi: false,
      };
    case "AUTOPLAY_BLOCKED":
      if (state.phase === "ended" || state.phase === "failed") return state;
      return {
        ...state,
        phase: "autoplay_blocked",
        showReconnectingUi: false,
        captureAvailable: false,
      };
    case "USER_PLAY":
      return {
        ...state,
        phase: "playing",
        captureAvailable: state.hasVideoTrack,
      };
    case "OFFLINE":
      if (state.phase === "ended" || state.phase === "failed") return state;
      return {
        ...state,
        phase: "interrupted",
        lastReason: "offline",
        captureAvailable: false,
      };
    case "MANUAL_RETRY":
      return {
        ...state,
        phase: "reconnecting",
        generation: state.generation + 1,
        retryCount: 0,
        lastReason: "manual_retry",
        hasVideoTrack: false,
        hasAudioTrack: false,
        captureAvailable: false,
        showReconnectingUi: true,
      };
    case "ENDED":
      return {
        ...state,
        phase: "ended",
        captureAvailable: false,
        showReconnectingUi: false,
        lastReason: "authoritative_end",
      };
    case "RESET_RETRIES":
      return { ...state, retryCount: 0 };
    case "SHOW_RECONNECT_UI":
      if (state.phase === "playing" || state.phase === "ended" || state.phase === "failed") {
        return state;
      }
      return { ...state, showReconnectingUi: true };
    case "HIDE_RECONNECT_UI":
      return { ...state, showReconnectingUi: false };
    default:
      return state;
  }
}

export function canAutoReconnect(state: WhepViewerState): boolean {
  return (
    state.phase !== "ended" &&
    state.phase !== "failed" &&
    state.retryCount < WHEP_MAX_AUTO_RETRIES
  );
}

export function isCaptureAllowed(state: WhepViewerState): boolean {
  return playingCapture(state) && state.captureAvailable;
}

export function isPlaybackHealthy(state: WhepViewerState): boolean {
  return state.phase === "playing" && state.hasVideoTrack;
}
