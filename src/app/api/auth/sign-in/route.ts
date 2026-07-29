import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, nextRouteForUser, toPublicAccount } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import {
  canAttemptIp,
  ipFromRequest,
  recordIpAttempt,
} from "@/lib/rate-limit";
import { jsonError, normalizeUsername, signInSchema } from "@/lib/validation";

const GENERIC_ERROR = "Invalid email/username or password";

export async function POST(req: NextRequest) {
  const ip = ipFromRequest(req);
  if (!canAttemptIp(ip, { maxAttempts: 10 })) {
    return jsonError("Too many attempts. Try again later.", 429);
  }

  try {
    const body = await req.json();
    const parsed = signInSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const { identifier, password } = parsed.data;
    // A leading "@" always means a username handle, never an email address.
    const hasLeadingAt = identifier.startsWith("@");
    const isEmail = !hasLeadingAt && identifier.includes("@");
    const user = isEmail
      ? await prisma.user.findUnique({ where: { email: identifier.toLowerCase() } })
      : await prisma.user.findFirst({ where: { username: normalizeUsername(identifier) } });

    if (!user || user.deletedAt) {
      recordIpAttempt(ip);
      return jsonError(GENERIC_ERROR, 401);
    }

    if (!user.passwordHash) {
      recordIpAttempt(ip);
      return jsonError("Set a password to continue", 400, { code: "NEED_PASSWORD" });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      recordIpAttempt(ip);
      return jsonError(GENERIC_ERROR, 401);
    }

    await createSession(user.id);
    const next = nextRouteForUser(user);

    return Response.json({
      ok: true,
      account: toPublicAccount(user),
      next,
    });
  } catch (err) {
    console.error("[sign-in]", err);
    return jsonError("Could not sign in", 500);
  }
}
