"use client";

type WhipHandle = {
  pc: RTCPeerConnection;
  resourceUrl: string;
};

export type WhepHandle = {
  pc: RTCPeerConnection;
  resourceUrl: string | null;
  stream: MediaStream;
};

function waitIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const t = window.setTimeout(() => resolve(), 2500);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        window.clearTimeout(t);
        resolve();
      }
    });
  });
}

/** WHIP publish to Cloudflare Stream. Video goes to Stream, not Vercel. */
export async function startWhipPublish(
  whipUrl: string,
  stream: MediaStream,
): Promise<WhipHandle> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
    bundlePolicy: "max-bundle",
  });
  for (const track of stream.getTracks()) {
    pc.addTransceiver(track, { direction: "sendonly" });
  }
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIce(pc);
  const res = await fetch(whipUrl, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription?.sdp || "",
  });
  if (!res.ok) {
    pc.close();
    throw new Error("Could not publish Live video");
  }
  const answer = await res.text();
  const location = res.headers.get("Location");
  await pc.setRemoteDescription({ type: "answer", sdp: answer });
  return {
    pc,
    resourceUrl: location ? new URL(location, whipUrl).toString() : whipUrl,
  };
}

export async function stopWhipPublish(handle: WhipHandle | null) {
  if (!handle) return;
  try {
    await fetch(handle.resourceUrl, { method: "DELETE" });
  } catch {
    /* ignore */
  }
  handle.pc.getSenders().forEach((s) => s.track?.stop());
  handle.pc.close();
}

export type WhepPlaybackOptions = {
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onIceConnectionStateChange?: (state: RTCIceConnectionState) => void;
  onTrack?: (track: MediaStreamTrack) => void;
  /** Abort mid-negotiation when a newer generation supersedes this attempt. */
  signal?: AbortSignal;
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new Error("WHEP aborted");
    err.name = "AbortError";
    throw err;
  }
}

/** WHEP playback — Cloudflare reference: single MediaStream, recvonly transceivers. */
export async function startWhepPlayback(
  whepUrl: string,
  video: HTMLVideoElement,
  opts?: WhepPlaybackOptions,
): Promise<WhepHandle> {
  throwIfAborted(opts?.signal);
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
    bundlePolicy: "max-bundle",
  });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  const stream = new MediaStream();
  video.srcObject = stream;
  pc.ontrack = (event) => {
    const track = event.track;
    if (!stream.getTracks().some((t) => t.id === track.id)) {
      stream.addTrack(track);
    }
    // Some engines need srcObject reassignment after the first track arrives.
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    opts?.onTrack?.(track);
  };

  if (opts?.onConnectionStateChange) {
    pc.onconnectionstatechange = () => {
      opts.onConnectionStateChange?.(pc.connectionState);
    };
  }
  if (opts?.onIceConnectionStateChange) {
    pc.oniceconnectionstatechange = () => {
      opts.onIceConnectionStateChange?.(pc.iceConnectionState);
    };
  }

  try {
    const offer = await pc.createOffer();
    throwIfAborted(opts?.signal);
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    throwIfAborted(opts?.signal);
    const res = await fetch(whepUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription?.sdp || "",
      signal: opts?.signal,
    });
    if (!res.ok) {
      pc.close();
      throw new Error("Could not start Live playback");
    }
    const answer = await res.text();
    const location = res.headers.get("Location");
    throwIfAborted(opts?.signal);
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    return {
      pc,
      stream,
      resourceUrl: location ? new URL(location, whepUrl).toString() : null,
    };
  } catch (err) {
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.close();
    throw err;
  }
}

export async function stopWhepPlayback(handle: WhepHandle | null) {
  if (!handle) return;
  try {
    if (handle.resourceUrl) {
      await fetch(handle.resourceUrl, { method: "DELETE" });
    }
  } catch {
    /* ignore */
  }
  handle.pc.ontrack = null;
  handle.pc.onconnectionstatechange = null;
  handle.pc.oniceconnectionstatechange = null;
  for (const track of handle.stream.getTracks()) {
    try {
      handle.stream.removeTrack(track);
      track.stop();
    } catch {
      /* ignore */
    }
  }
  handle.pc.getReceivers().forEach((r) => {
    try {
      r.track?.stop();
    } catch {
      /* ignore */
    }
  });
  handle.pc.close();
}
