"use client";

type WhipHandle = {
  pc: RTCPeerConnection;
  resourceUrl: string;
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

export async function startWhepPlayback(
  whepUrl: string,
  video: HTMLVideoElement,
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
  });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  pc.ontrack = (ev) => {
    const [stream] = ev.streams;
    if (stream) video.srcObject = stream;
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIce(pc);
  const res = await fetch(whepUrl, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription?.sdp || "",
  });
  if (!res.ok) {
    pc.close();
    throw new Error("Could not start Live playback");
  }
  const answer = await res.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answer });
  return pc;
}
