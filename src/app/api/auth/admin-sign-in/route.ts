import { NextRequest } from "next/server";
import { createSession, nextRouteForUser, toPublicAccount } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { jsonError } from "@/lib/validation";

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;

function canAttempt(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= Date.now()) {
    attempts.delete(key);
    return true;
  }
  return entry.count < MAX_FAILURES;
}

function failedAttempt(key: string) {
  const current = attempts.get(key);
  if (!current || current.resetAt <= Date.now()) {
    attempts.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  } else {
    current.count += 1;
  }
}

export async function POST(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || "unknown";
  if (!canAttempt(ip)) return jsonError("Invalid credentials", 429);
  try {
    const body = await req.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      failedAttempt(ip);
      return jsonError("Invalid credentials", 401);
    }
    const user = await prisma.user.findFirst({ where: { username } });
    const valid =
      user?.role === "ADMIN" &&
      Boolean(user.passwordHash) &&
      (await verifyPassword(password, user.passwordHash!));
    if (!user || !valid) {
      failedAttempt(ip);
      return jsonError("Invalid credentials", 401);
    }
    attempts.delete(ip);
    // Legacy isAdmin is kept aligned whenever an administrator signs in.
    if (!user.isAdmin) await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
    await createSession(user.id);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return Response.json({ ok: true, account: toPublicAccount(fresh), next: nextRouteForUser(fresh) });
  } catch (error) {
    console.error("[admin-sign-in]", error);
    return jsonError("Invalid credentials", 401);
  }
}
