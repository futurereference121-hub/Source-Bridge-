import { createSign } from "crypto";
import {
  loadStreamSigningPrivateKey,
  streamSigningKeyId,
  StreamSigningKeyError,
} from "./signing-key";

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * Cloudflare Stream signed playback token (RS256).
 * https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/
 * Tokens never expire after `expUnix` — callers must cap at session endsAt.
 */
export function signCloudflareStreamToken(opts: {
  sub: string;
  kid?: string;
  expUnix: number;
  nbfUnix?: number;
}): string {
  const kid = (opts.kid || streamSigningKeyId()).trim();
  if (!kid) throw new StreamSigningKeyError();

  const header = { alg: "RS256", kid };
  const payload: Record<string, unknown> = {
    sub: opts.sub,
    kid,
    exp: opts.expUnix,
  };
  if (opts.nbfUnix != null) payload.nbf = opts.nbfUnix;
  const data = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const sign = createSign("RSA-SHA256");
  sign.update(data);
  sign.end();
  try {
    const sig = sign.sign(loadStreamSigningPrivateKey());
    return `${data}.${sig.toString("base64url")}`;
  } catch (err) {
    if (err instanceof StreamSigningKeyError) throw err;
    throw new StreamSigningKeyError();
  }
}

export function streamCustomerHost(customerCode: string): string {
  const code = customerCode.replace(/^customer-/, "");
  return `https://customer-${code}.cloudflarestream.com`;
}

export function signedHlsUrl(host: string, token: string): string {
  return `${host}/${token}/manifest/video.m3u8?dvrEnabled=true`;
}

export function signedWhepUrl(host: string, token: string): string {
  return `${host}/${token}/webRTC/play`;
}

export function signedThumbnailUrl(
  host: string,
  token: string,
  offsetSeconds: number,
): string {
  const time = Math.max(0, Math.floor(offsetSeconds));
  return `${host}/${token}/thumbnails/thumbnail.jpg?time=${time}s&height=720`;
}
