import { createPrivateKey, type KeyObject } from "crypto";

export const STREAM_SIGNING_KEY_INVALID = "STREAM_SIGNING_KEY_INVALID";

export class StreamSigningKeyError extends Error {
  code = STREAM_SIGNING_KEY_INVALID;

  constructor() {
    super(STREAM_SIGNING_KEY_INVALID);
  }
}

const PEM_MARKER = "-----BEGIN";

function looksLikePem(value: string): boolean {
  return value.includes(PEM_MARKER);
}

/**
 * Normalize Cloudflare Stream signing key material from env.
 *
 * CASE 1: Real PEM (-----BEGIN …)
 * CASE 2: Escaped PEM (\\n literals)
 * CASE 3: Cloudflare base64 PEM (POST /stream/keys) — decode once, verify PEM header
 *
 * Never double-decode. Never log key material.
 */
export function normalizeStreamSigningKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new StreamSigningKeyError();

  // CASE 1 + CASE 2: PEM as stored (possibly with literal \n)
  const unescaped = trimmed.replace(/\\n/g, "\n").trim();
  if (looksLikePem(unescaped)) {
    return unescaped;
  }

  // CASE 3: base64-wrapped PEM from Cloudflare keys API
  const compact = trimmed.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/=]+$/.test(compact)) {
    try {
      const decoded = Buffer.from(compact, "base64").toString("utf8").trim();
      if (looksLikePem(decoded)) {
        return decoded;
      }
    } catch {
      /* fall through */
    }
  }

  throw new StreamSigningKeyError();
}

/** Load RS256 private key from PEM or JWK env. Maps crypto failures to STREAM_SIGNING_KEY_INVALID. */
export function loadStreamSigningPrivateKey(): KeyObject {
  const pem = (process.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM || "").trim();
  if (pem) {
    try {
      return createPrivateKey(normalizeStreamSigningKey(pem));
    } catch (err) {
      if (err instanceof StreamSigningKeyError) throw err;
      throw new StreamSigningKeyError();
    }
  }
  const jwkRaw = (process.env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK || "").trim();
  if (jwkRaw) {
    try {
      return createPrivateKey({
        key: JSON.parse(jwkRaw) as import("crypto").JsonWebKey,
        format: "jwk",
      });
    } catch {
      throw new StreamSigningKeyError();
    }
  }
  throw new StreamSigningKeyError();
}

export function streamSigningKeyId(): string {
  return (process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID || "").trim();
}
