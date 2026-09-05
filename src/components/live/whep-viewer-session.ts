"use client";

/**
 * Generation-safe WHEP viewer session.
 * Only the current connection generation may mutate player state / media.
 */

import {
  startWhepPlayback,
  stopWhepPlayback,
  type WhepHandle,
} from "@/components/live/whip";
import {
  WHEP_FRAME_POLL_MS,
  WHEP_ICE_DISCONNECT_GRACE_MS,
  WHEP_MAX_AUTO_RETRIES,
  WHEP_RECONNECT_UI_DELAY_MS,
  WHEP_RENDER_STALL_MS,
  WHEP_STABLE_PLAYBACK_RESET_MS,
  WHEP_TRACK_MUTE_GRACE_MS,
  whepBackoffMs,
  type WhepReconnectReason,
} from "@/lib/live/whep-viewer-policy";
import {
  canAutoReconnect,
  initialWhepViewerState,
  isCaptureAllowed,
  isPlaybackHealthy,
  reduceWhepViewer,
  type WhepViewerState,
} from "@/lib/live/whep-viewer-state";

export type WatchGrantLike = {
  playback: {
    whepUrl: string | null;
    tokenExp: number;
  };
  endsAt: string;
  serverNow: string;
};

export type WhepViewerSessionHooks = {
  fetchGrant: () => Promise<WatchGrantLike | null>;
  onState: (state: WhepViewerState) => void;
  /** Privacy-safe coarse diagnostics (no tokens/SDP). */
  onDiag?: (event: string, detail?: Record<string, string | number | boolean>) => void;
};

type Timer = number;

export class WhepViewerSession {
  private video: HTMLVideoElement;
  private hooks: WhepViewerSessionHooks;
  private state = initialWhepViewerState();
  private handle: WhepHandle | null = null;
  private grant: WatchGrantLike | null = null;
  private generation = 0;
  private connectAbort: AbortController | null = null;
  private reconnectTimer: Timer | null = null;
  private graceTimer: Timer | null = null;
  private uiDelayTimer: Timer | null = null;
  private framePollTimer: Timer | null = null;
  private stableTimer: Timer | null = null;
  private rvfcId: number | null = null;
  private lastFrameAt = 0;
  private lastCurrentTime = 0;
  private connecting = false;
  private disposed = false;
  private online = typeof navigator !== "undefined" ? navigator.onLine : true;
  private trackCleanups: Array<() => void> = [];
  private mediaCleanups: Array<() => void> = [];
  private docCleanups: Array<() => void> = [];

  constructor(video: HTMLVideoElement, hooks: WhepViewerSessionHooks) {
    this.video = video;
    this.hooks = hooks;
    this.bindDocumentLifecycle();
    this.bindMediaEvents();
  }

  getState() {
    return this.state;
  }

  captureAllowed() {
    return isCaptureAllowed(this.state);
  }

  /** Soft-update grant without tearing down a healthy PeerConnection. */
  setGrant(grant: WatchGrantLike | null) {
    this.grant = grant;
  }

  async start(grant: WatchGrantLike) {
    if (this.disposed) return;
    this.grant = grant;
    this.dispatch({ type: "START" });
    await this.connect("initial");
  }

  async manualRetry() {
    if (this.disposed || this.state.phase === "ended") return;
    this.clearReconnectTimer();
    // connect() owns the RECONNECT transition (single generation bump).
    await this.connect("manual_retry");
  }

  markEnded() {
    this.dispatch({ type: "ENDED" });
    this.teardownMedia();
  }

  dispose() {
    this.disposed = true;
    this.dispatch({ type: "ENDED" });
    this.teardownMedia();
    for (const off of this.docCleanups) off();
    for (const off of this.mediaCleanups) off();
    this.docCleanups = [];
    this.mediaCleanups = [];
  }

  private emit() {
    this.hooks.onState(this.state);
  }

  private diag(event: string, detail?: Record<string, string | number | boolean>) {
    try {
      this.hooks.onDiag?.(event, detail);
    } catch {
      /* ignore */
    }
  }

  private dispatch(
    event: Parameters<typeof reduceWhepViewer>[1],
  ) {
    this.state = reduceWhepViewer(this.state, event);
    this.generation = this.state.generation;
    this.emit();
  }

  private isCurrent(gen: number) {
    return !this.disposed && gen === this.generation && this.state.phase !== "ended";
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearGraceTimer() {
    if (this.graceTimer != null) {
      window.clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  private clearUiDelay() {
    if (this.uiDelayTimer != null) {
      window.clearTimeout(this.uiDelayTimer);
      this.uiDelayTimer = null;
    }
  }

  private clearFrameWatch() {
    if (this.framePollTimer != null) {
      window.clearInterval(this.framePollTimer);
      this.framePollTimer = null;
    }
    if (this.rvfcId != null && "cancelVideoFrameCallback" in this.video) {
      try {
        (
          this.video as HTMLVideoElement & {
            cancelVideoFrameCallback: (id: number) => void;
          }
        ).cancelVideoFrameCallback(this.rvfcId);
      } catch {
        /* ignore */
      }
      this.rvfcId = null;
    }
    if (this.stableTimer != null) {
      window.clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  private clearTrackListeners() {
    for (const off of this.trackCleanups) off();
    this.trackCleanups = [];
  }

  private teardownMedia() {
    this.clearReconnectTimer();
    this.clearGraceTimer();
    this.clearUiDelay();
    this.clearFrameWatch();
    this.clearTrackListeners();
    this.connectAbort?.abort();
    this.connectAbort = null;
    this.connecting = false;
    const h = this.handle;
    this.handle = null;
    this.video.srcObject = null;
    void stopWhepPlayback(h);
  }

  private scheduleReconnectUi() {
    this.clearUiDelay();
    this.uiDelayTimer = window.setTimeout(() => {
      if (
        this.state.phase === "interrupted" ||
        this.state.phase === "reconnecting" ||
        this.state.phase === "connecting"
      ) {
        this.dispatch({ type: "SHOW_RECONNECT_UI" });
      }
    }, WHEP_RECONNECT_UI_DELAY_MS);
  }

  private beginInterrupt(reason: string, graceMs: number, rebuildReason: WhepReconnectReason) {
    if (!canAutoReconnect(this.state) && this.state.phase !== "reconnecting") {
      this.dispatch({ type: "RETRY_EXHAUSTED", reason });
      return;
    }
    this.dispatch({ type: "INTERRUPT", reason });
    this.scheduleReconnectUi();
    this.clearGraceTimer();
    const gen = this.generation;
    this.graceTimer = window.setTimeout(() => {
      if (!this.isCurrent(gen)) return;
      if (this.state.phase === "playing") return;
      this.diag("grace_expired", { reason: rebuildReason });
      this.queueReconnect(rebuildReason);
    }, graceMs);
  }

  private queueReconnect(reason: WhepReconnectReason) {
    if (this.disposed || this.state.phase === "ended") return;
    if (!this.online && reason !== "manual_retry") {
      this.dispatch({ type: "OFFLINE" });
      this.scheduleReconnectUi();
      return;
    }
    if (this.connecting) return;
    if (!canAutoReconnect(this.state) && reason !== "manual_retry") {
      this.dispatch({ type: "RETRY_EXHAUSTED", reason });
      return;
    }

    this.clearGraceTimer();
    this.clearReconnectTimer();
    const attempt = this.state.retryCount;
    const delay =
      reason === "manual_retry" || reason === "initial" ? 0 : whepBackoffMs(attempt);
    this.diag("reconnect_scheduled", { reason, attempt, delay });
    this.reconnectTimer = window.setTimeout(() => {
      if (this.disposed || this.state.phase === "ended") return;
      void this.connect(reason);
    }, delay);
  }

  private async connect(reason: WhepReconnectReason) {
    if (this.disposed || this.state.phase === "ended") return;
    if (this.connecting) return;
    this.connecting = true;
    this.clearReconnectTimer();
    this.clearGraceTimer();
    this.clearFrameWatch();
    this.clearTrackListeners();

    if (reason !== "initial") {
      this.dispatch({ type: "RECONNECT", reason });
      if (this.state.phase === "failed") {
        this.connecting = false;
        return;
      }
    }
    const gen = this.generation;
    this.diag("reconnect_start", { reason, generation: gen });

    this.connectAbort?.abort();
    const abort = new AbortController();
    this.connectAbort = abort;

    const prev = this.handle;
    this.handle = null;
    void stopWhepPlayback(prev);

    try {
      // Fresh auth on every rebuild — never reuse an expired signed WHEP URL.
      const nextGrant = await this.hooks.fetchGrant();
      if (!this.isCurrent(gen) || abort.signal.aborted) return;
      if (!nextGrant) {
        // fetchGrant returns null on 401 (auth redirect) — stop quietly.
        return;
      }
      this.grant = nextGrant;
      if (!nextGrant.playback.whepUrl) {
        throw new Error("missing_whep");
      }

      this.video.playsInline = true;
      const handle = await startWhepPlayback(nextGrant.playback.whepUrl, this.video, {
        signal: abort.signal,
        onConnectionStateChange: (pcState) => {
          if (!this.isCurrent(gen)) return;
          if (pcState === "connected") {
            this.clearGraceTimer();
            this.diag("pc_connected", { generation: gen });
          } else if (pcState === "disconnected") {
            this.diag("pc_disconnected", { generation: gen });
            this.beginInterrupt("ice_disconnected", WHEP_ICE_DISCONNECT_GRACE_MS, "ice_disconnected");
          } else if (pcState === "failed" || pcState === "closed") {
            this.diag("pc_failed", { generation: gen, state: pcState });
            this.queueReconnect(pcState === "failed" ? "pc_failed" : "pc_failed");
          }
        },
        onIceConnectionStateChange: (ice) => {
          if (!this.isCurrent(gen)) return;
          if (ice === "connected" || ice === "completed") {
            this.clearGraceTimer();
          } else if (ice === "disconnected") {
            this.beginInterrupt("ice_disconnected", WHEP_ICE_DISCONNECT_GRACE_MS, "ice_disconnected");
          } else if (ice === "failed") {
            this.queueReconnect("ice_failed");
          }
        },
        onTrack: (track) => {
          if (!this.isCurrent(gen)) return;
          this.dispatch({
            type: "TRACK",
            kind: track.kind === "audio" ? "audio" : "video",
          });
          this.diag("track_received", { kind: track.kind });
          this.attachTrackWatchers(track, gen);
          if (track.kind === "video") {
            this.ensureSrcObject();
            void this.tryPlay(gen);
            this.startFrameWatch(gen);
          }
        },
      });

      if (!this.isCurrent(gen) || abort.signal.aborted) {
        void stopWhepPlayback(handle);
        return;
      }
      this.handle = handle;
      this.dispatch({ type: "NEGOTIATED" });
      void this.tryPlay(gen);
      this.diag("negotiate_ok", { generation: gen });
    } catch (err) {
      if (!this.isCurrent(gen)) return;
      if ((err as { name?: string }).name === "AbortError") return;
      this.diag("negotiate_error", { generation: gen });
      if (this.state.retryCount + 1 >= WHEP_MAX_AUTO_RETRIES && reason !== "manual_retry") {
        this.dispatch({ type: "RETRY_EXHAUSTED", reason: "negotiate_error" });
      } else {
        this.queueReconnect("negotiate_error");
      }
    } finally {
      if (this.generation === gen) this.connecting = false;
    }
  }

  private ensureSrcObject() {
    const stream = this.handle?.stream;
    if (!stream) return;
    if (this.video.srcObject !== stream) {
      this.video.srcObject = stream;
    }
  }

  private async tryPlay(gen: number) {
    if (!this.isCurrent(gen)) return;
    try {
      await this.video.play();
      if (!this.isCurrent(gen)) return;
      this.dispatch({ type: "PLAYING" });
      this.armStableReset(gen);
    } catch {
      if (!this.isCurrent(gen)) return;
      // Do not loop play() — wait for a user gesture.
      this.dispatch({ type: "AUTOPLAY_BLOCKED" });
      this.diag("autoplay_blocked", { generation: gen });
    }
  }

  async userGesturePlay() {
    if (this.disposed || this.state.phase === "ended") return;
    try {
      this.ensureSrcObject();
      await this.video.play();
      this.dispatch({ type: "USER_PLAY" });
    } catch {
      this.dispatch({ type: "AUTOPLAY_BLOCKED" });
    }
  }

  private attachTrackWatchers(track: MediaStreamTrack, gen: number) {
    const onMute = () => {
      if (!this.isCurrent(gen)) return;
      if (track.kind !== "video") return;
      this.diag("track_mute", { kind: track.kind });
      this.beginInterrupt("track_mute", WHEP_TRACK_MUTE_GRACE_MS, "track_mute_timeout");
    };
    const onUnmute = () => {
      if (!this.isCurrent(gen)) return;
      this.diag("track_unmute", { kind: track.kind });
      this.clearGraceTimer();
      this.ensureSrcObject();
      void this.tryPlay(gen);
      if (this.state.phase === "interrupted" || this.state.phase === "reconnecting") {
        this.dispatch({ type: "RECOVERED" });
      }
    };
    const onEnded = () => {
      if (!this.isCurrent(gen)) return;
      this.diag("track_ended", { kind: track.kind });
      if (track.kind === "video") this.queueReconnect("track_ended");
    };
    track.addEventListener("mute", onMute);
    track.addEventListener("unmute", onUnmute);
    track.addEventListener("ended", onEnded);
    this.trackCleanups.push(() => {
      track.removeEventListener("mute", onMute);
      track.removeEventListener("unmute", onUnmute);
      track.removeEventListener("ended", onEnded);
    });
  }

  private noteFrame(gen: number) {
    if (!this.isCurrent(gen)) return;
    this.lastFrameAt = Date.now();
    // Avoid per-frame React updates once healthy playback is established.
    if (
      this.state.phase !== "playing" ||
      !this.state.captureAvailable ||
      this.state.showReconnectingUi
    ) {
      this.dispatch({ type: "FRAME_OK" });
    }
    this.armStableReset(gen);
  }

  private armStableReset(gen: number) {
    if (this.state.retryCount === 0) return;
    if (this.stableTimer != null) return;
    this.stableTimer = window.setTimeout(() => {
      this.stableTimer = null;
      if (!this.isCurrent(gen)) return;
      if (isPlaybackHealthy(this.state)) {
        this.dispatch({ type: "RESET_RETRIES" });
      }
    }, WHEP_STABLE_PLAYBACK_RESET_MS);
  }

  private startFrameWatch(gen: number) {
    this.clearFrameWatch();
    this.lastFrameAt = Date.now();
    this.lastCurrentTime = this.video.currentTime || 0;

    const video = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (
        cb: (now: number, meta?: unknown) => void,
      ) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };

    if (typeof video.requestVideoFrameCallback === "function") {
      const loop = () => {
        if (!this.isCurrent(gen)) return;
        this.noteFrame(gen);
        this.rvfcId = video.requestVideoFrameCallback!(loop);
      };
      this.rvfcId = video.requestVideoFrameCallback(loop);
    }

    this.framePollTimer = window.setInterval(() => {
      if (!this.isCurrent(gen)) return;
      const t = this.video.currentTime || 0;
      if (t > this.lastCurrentTime + 0.01) {
        this.lastCurrentTime = t;
        this.noteFrame(gen);
        return;
      }
      // rVFC browsers already note frames; stall uses lastFrameAt either way.
      if (
        this.handle?.pc.connectionState === "connected" &&
        this.state.hasVideoTrack &&
        (this.state.phase === "playing" || this.state.phase === "interrupted") &&
        Date.now() - this.lastFrameAt >= WHEP_RENDER_STALL_MS
      ) {
        this.diag("render_stall", { generation: gen });
        this.queueReconnect("render_stall");
      }
    }, WHEP_FRAME_POLL_MS);
  }

  private bindMediaEvents() {
    const onPlaying = () => {
      if (this.state.phase === "ended" || this.state.phase === "failed") return;
      this.dispatch({ type: "PLAYING" });
      this.clearGraceTimer();
      this.clearUiDelay();
      this.dispatch({ type: "HIDE_RECONNECT_UI" });
    };
    const onWaiting = () => {
      if (this.state.phase !== "playing") return;
      this.beginInterrupt("waiting", WHEP_RENDER_STALL_MS, "render_stall");
    };
    const onPause = () => {
      // Ignore intentional pause from ended teardown.
      if (this.state.phase === "ended" || this.state.phase === "failed") return;
    };
    this.video.addEventListener("playing", onPlaying);
    this.video.addEventListener("waiting", onWaiting);
    this.video.addEventListener("pause", onPause);
    this.mediaCleanups.push(() => {
      this.video.removeEventListener("playing", onPlaying);
      this.video.removeEventListener("waiting", onWaiting);
      this.video.removeEventListener("pause", onPause);
    });
  }

  private verifyHealthOrReconnect(reason: WhepReconnectReason) {
    if (this.disposed || this.state.phase === "ended" || this.state.phase === "failed") {
      return;
    }
    const pc = this.handle?.pc;
    const connected =
      pc &&
      (pc.connectionState === "connected" || pc.connectionState === "connecting");
    const recentFrame = Date.now() - this.lastFrameAt < WHEP_RENDER_STALL_MS;
    if (connected && this.state.hasVideoTrack && recentFrame && !this.video.paused) {
      this.dispatch({ type: "RECOVERED" });
      return;
    }
    this.queueReconnect(reason);
  }

  private bindDocumentLifecycle() {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        this.verifyHealthOrReconnect("foreground_unhealthy");
      }
    };
    const onPageShow = () => {
      this.verifyHealthOrReconnect("foreground_unhealthy");
    };
    const onOnline = () => {
      this.online = true;
      this.diag("online", {});
      this.verifyHealthOrReconnect("offline_recovery");
    };
    const onOffline = () => {
      this.online = false;
      this.diag("offline", {});
      this.clearReconnectTimer();
      this.dispatch({ type: "OFFLINE" });
      this.scheduleReconnectUi();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    this.docCleanups.push(() => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    });
  }
}
