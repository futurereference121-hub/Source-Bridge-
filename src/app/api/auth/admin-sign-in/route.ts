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
    if (!username) {
      failedAttempt(ip);
      return jsonError("Invalid credentials", 401);
    }

    const user = await prisma.user.findFirst({ where: { username } });

    // Only the one designated admin account may use this endpoint.
    if (!user || user.role !== "ADMIN") {
      failedAttempt(ip);
      return jsonError("Invalid credentials", 401);
    }

    // First-time setup: no password has ever been created for this account.
    // We only allow this when no password is submitted (the sign-in form sent
    // just the username), keeping the redirect invisible to non-admins.
    if (!user.adminPasswordCreated && !user.passwordHash) {
      // Respond with a special code that the client uses to redirect.
      // No session is created yet.
      return Response.json({ ok: false, code: "NEED_FIRST_PASSWORD", next: "/admin/create-password" }, { status: 200 });
    }

    // Normal authentication path.
    if (!password) {
      failedAttempt(ip);
      return jsonError("Invalid credentials", 401);
    }

    const valid =
      Boolean(user.passwordHash) &&
      (await verifyPassword(password, user.passwordHash!));
    if (!valid) {
      failedAttempt(ip);
      return jsonError("Invalid credentials", 401);
    }

    attempts.delete(ip);
    if (!user.isAdmin) await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
    await createSession(user.id);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return Response.json({ ok: true, account: toPublicAccount(fresh), next: nextRouteForUser(fresh) });
  } catch (error) {
    console.error("[admin-sign-in]", error);
    return jsonError("Invalid credentials", 401);
  }
}
