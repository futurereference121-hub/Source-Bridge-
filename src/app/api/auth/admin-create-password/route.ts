import { NextRequest } from "next/server";
import { createSession, toPublicAccount } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashPassword, validatePasswordStrength } from "@/lib/password";
import { jsonError } from "@/lib/validation";

// Rate-limit by IP: 5 attempts per 15 minutes (same as sign-in).
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;

function canAttempt(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= Date.now()) { attempts.delete(key); return true; }
  return entry.count < MAX_FAILURES;
}
function failedAttempt(key: string) {
  const current = attempts.get(key);
  if (!current || current.resetAt <= Date.now()) {
    attempts.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  } else { current.count += 1; }
}

export async function POST(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || "unknown";
  if (!canAttempt(ip)) return jsonError("Too many attempts", 429);

  try {
    const body = await req.json().catch(() => ({}));
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    if (!password || !confirmPassword) {
      failedAttempt(ip);
      return jsonError("All fields are required", 400);
    }
    if (password !== confirmPassword) {
      return jsonError("Passwords do not match", 400);
    }

    const strengthError = validatePasswordStrength(password);
    if (strengthError) {
      return jsonError(strengthError, 400);
    }

    const user = await prisma.user.findFirst({
      where: { username: "adminsource", role: "ADMIN" },
    });

    if (!user) {
      failedAttempt(ip);
      return jsonError("Not available", 403);
    }

    // Hard guard: only allow when no password has ever been set.
    if (user.adminPasswordCreated || user.passwordHash) {
      return jsonError("Administrator password has already been set", 403);
    }

    const passwordHash = await hashPassword(password);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        adminPasswordCreated: true,
        mustChangePassword: false,
        isAdmin: true,
      },
    });

    attempts.delete(ip);
    await createSession(user.id);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return Response.json({ ok: true, account: toPublicAccount(fresh) });
  } catch (error) {
    console.error("[admin-create-password]", error);
    return jsonError("Could not set password", 500);
  }
}
