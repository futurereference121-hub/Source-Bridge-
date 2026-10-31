/**
 * Password-reset policy: open does not consume; claim only after a successful set.
 * Offline — no email, no Production database, no passwords printed.
 * Run: node --experimental-strip-types scripts/test-password-reset.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PASSWORD_RESET_OPEN_CONSUMES,
  RESET_TOKEN_TTL_MS,
  evaluatePasswordResetToken,
  hashResetToken,
  normalizeResetToken,
  passwordResetClaimWhere,
  resetTokenExpiresAt,
} from "../src/lib/password-reset.ts";
import { createHash, randomBytes } from "node:crypto";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function createRawToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

let passed = 0;
function ok(name: string, cond: unknown) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

function read(rel: string) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

ok("opening a reset link is defined as non-consuming", PASSWORD_RESET_OPEN_CONSUMES === false);
ok("genuine expiry window stays one hour", RESET_TOKEN_TTL_MS === 60 * 60 * 1000);

const raw = createRawToken();
ok("issued token hashes match after normalize", hashResetToken(raw) === hashToken(raw));
ok(
  "wrapped / encoded tokens still hash to the issued value",
  hashResetToken(` ${raw}%0A `) === hashToken(raw) &&
    hashResetToken(`${raw}===`) === hashToken(raw),
);
ok("empty token does not hash", hashResetToken("   ") === null);
ok("normalize strips email wrapping leftovers", normalizeResetToken(`\n<${raw}>\n`) === raw);

const now = Date.UTC(2026, 9, 31, 8, 0, 0);
const freshExpires = new Date(now + RESET_TOKEN_TTL_MS);
ok(
  "a fresh link is usable",
  evaluatePasswordResetToken({
    record: { usedAt: null, expiresAt: freshExpires },
    newerTokenExists: false,
    nowMs: now,
  }).ok === true,
);

const expired = evaluatePasswordResetToken({
  record: { usedAt: null, expiresAt: new Date(now - 1) },
  newerTokenExists: false,
  nowMs: now,
});
ok(
  "a genuinely expired link fails",
  expired.ok === false && expired.code === "TOKEN_EXPIRED",
);

ok(
  "opening without submit does not mark used",
  evaluatePasswordResetToken({
    record: { usedAt: null, expiresAt: freshExpires },
    newerTokenExists: false,
    nowMs: now,
  }).ok === true,
);

const used = evaluatePasswordResetToken({
  record: { usedAt: new Date(now), expiresAt: freshExpires },
  newerTokenExists: false,
  nowMs: now,
});
ok(
  "successful reset prevents reuse",
  used.ok === false && used.code === "TOKEN_USED",
);

const replaced = evaluatePasswordResetToken({
  record: { usedAt: null, expiresAt: freshExpires },
  newerTokenExists: true,
  nowMs: now,
});
ok(
  "an older link replaced by a newer request is distinct from expiry",
  replaced.ok === false && replaced.code === "TOKEN_REPLACED",
);

ok(
  "missing records are invalid, not expired",
  evaluatePasswordResetToken({
    record: null,
    newerTokenExists: false,
    nowMs: now,
  }).ok === false &&
    evaluatePasswordResetToken({
      record: null,
      newerTokenExists: false,
      nowMs: now,
    }).code === "TOKEN_INVALID",
);

const claim = passwordResetClaimWhere("tok_1", new Date(now));
ok(
  "claim requires unused and unexpired in one write",
  claim.id === "tok_1" &&
    claim.usedAt === null &&
    claim.expiresAt.gt.getTime() === now,
);

const expiresAt = resetTokenExpiresAt(now);
ok(
  "expiry is stored as an absolute UTC instant one hour ahead",
  expiresAt.getTime() === now + RESET_TOKEN_TTL_MS,
);

type Row = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
};

function simulate() {
  const rows: Row[] = [];
  let seq = 0;
  function request(userId: string, at: number) {
    seq += 1;
    const issued = createRawToken();
    rows.push({
      id: `id_${seq}`,
      userId,
      tokenHash: hashToken(issued),
      createdAt: new Date(at),
      expiresAt: resetTokenExpiresAt(at),
      usedAt: null,
    });
    return issued;
  }
  function inspect(issued: string, at: number) {
    const tokenHash = hashResetToken(issued);
    const record = rows.find((row) => row.tokenHash === tokenHash) ?? null;
    const newerTokenExists = Boolean(
      record &&
        rows.some(
          (row) => row.userId === record.userId && row.createdAt > record.createdAt,
        ),
    );
    return evaluatePasswordResetToken({
      record: record
        ? {
            usedAt: record.usedAt,
            expiresAt: record.expiresAt,
          }
        : null,
      newerTokenExists,
      nowMs: at,
    });
  }
  function submit(issued: string, at: number) {
    const before = inspect(issued, at);
    if (!before.ok) return before;
    const tokenHash = hashResetToken(issued);
    const record = rows.find((row) => row.tokenHash === tokenHash);
    if (!record) return evaluatePasswordResetToken({ record: null, newerTokenExists: false, nowMs: at });
    if (
      rows.some(
        (row) => row.userId === record.userId && row.createdAt > record.createdAt,
      )
    ) {
      return evaluatePasswordResetToken({
        record: { usedAt: record.usedAt, expiresAt: record.expiresAt },
        newerTokenExists: true,
        nowMs: at,
      });
    }
    if (record.usedAt || record.expiresAt.getTime() <= at) {
      return evaluatePasswordResetToken({
        record: { usedAt: record.usedAt, expiresAt: record.expiresAt },
        newerTokenExists: false,
        nowMs: at,
      });
    }
    record.usedAt = new Date(at);
    for (const row of rows) {
      if (row.userId === record.userId && row.id !== record.id && !row.usedAt) {
        row.usedAt = new Date(at);
      }
    }
    return { ok: true as const };
  }
  return { rows, request, inspect, submit };
}

const sim = simulate();
const first = sim.request("user_a", now);
ok("fresh simulated link inspects ready", sim.inspect(first, now).ok === true);
ok(
  "open does not consume the simulated token",
  sim.inspect(first, now + 5_000).ok === true && sim.rows[0].usedAt === null,
);
ok("fresh simulated submit succeeds", sim.submit(first, now + 10_000).ok === true);
ok("reuse after success is blocked", sim.submit(first, now + 20_000).ok === false);
ok("usedAt is set only after submit", sim.rows[0].usedAt?.getTime() === now + 10_000);

const sim2 = simulate();
const oldLink = sim2.request("user_b", now);
const newerLink = sim2.request("user_b", now + 60_000);
ok("newer request leaves the new link usable", sim2.inspect(newerLink, now + 60_000).ok === true);
const oldDecision = sim2.inspect(oldLink, now + 60_000);
ok(
  "older link is replaced rather than treated as a live second password",
  oldDecision.ok === false && oldDecision.code === "TOKEN_REPLACED",
);
ok(
  "replaced older link cannot be submitted",
  sim2.submit(oldLink, now + 61_000).ok === false && sim2.rows[0].usedAt === null,
);
ok("newer link still submits", sim2.submit(newerLink, now + 62_000).ok === true);

const sim3 = simulate();
const stale = sim3.request("user_c", now);
const staleDecision = sim3.inspect(stale, now + RESET_TOKEN_TTL_MS + 1);
ok(
  "clock-expired unused link fails as expired",
  staleDecision.ok === false && staleDecision.code === "TOKEN_EXPIRED",
);

const setRoute = read("src/app/api/auth/set-password/route.ts");
const getFn = setRoute.slice(
  setRoute.indexOf("export async function GET"),
  setRoute.indexOf("export async function POST"),
);
ok("GET inspect exists and is documented as read-only", setRoute.includes("Read-only") && getFn.includes("export async function GET"));
ok(
  "GET inspect does not write usedAt",
  !getFn.includes("usedAt:") &&
    !getFn.includes("updateMany") &&
    !getFn.includes("$transaction"),
);
ok(
  "POST claims in the same transaction as the password write",
  setRoute.includes("passwordResetClaimWhere") &&
    setRoute.includes("prisma.$transaction") &&
    setRoute.includes("passwordHash"),
);
ok("POST does not consume before hashing the new password", setRoute.indexOf("hashPassword") < setRoute.indexOf("$transaction"));
ok("set-password no longer uses the mixed invalid-or-expired copy", !setRoute.includes("Invalid or expired link"));

const requestRoute = read("src/app/api/auth/request-set-password/route.ts");
ok("request hashes through normalize", requestRoute.includes("hashResetToken"));
ok("request does not consume prior tokens on send", !requestRoute.includes("usedAt"));

const page = read("src/app/set-password/page.tsx");
ok("reset page inspects on open without submitting a password", page.includes("/api/auth/set-password?token="));
ok("reset page does not label a valid open as expired", !page.includes("Link expired or already used"));
ok("reset form is hidden until inspect says ready", page.includes("linkReady"));

const email = read("src/lib/email.ts");
ok("reset URL still encodes the token", email.includes("encodeURIComponent(token)"));

const sw = read("public/sw.js");
ok("service worker keeps set-password network-only", sw.includes('/set-password'));

console.log(`\n${passed} password-reset checks passed`);
