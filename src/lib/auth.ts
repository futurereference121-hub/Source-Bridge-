import { cookies } from "next/headers";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { SESSION_TTL_MS } from "@/lib/limits";
import type { User } from "@prisma/client";

const COOKIE_NAME = "sb_session";

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET is required in production");
    }
    return "dev-source-bridge-session-secret-change-me";
  }
  return secret;
}

export function hashValue(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function sign(value: string): string {
  return createHmac("sha256", getSessionSecret()).update(value).digest("hex");
}

/** Cookie payload: rawToken.signature */
function encodeCookie(rawToken: string): string {
  return `${rawToken}.${sign(rawToken)}`;
}

function decodeCookie(value: string): string | null {
  const idx = value.lastIndexOf(".");
  if (idx <= 0) return null;
  const raw = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const expected = sign(raw);
  try {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return raw;
  } catch {
    return null;
  }
}

export type SessionUser = Pick<
  User,
  | "id"
  | "email"
  | "emailVerified"
  | "identityVerified"
  | "identityVerificationStatus"
  | "isAdmin"
  | "role"
  | "mustChangePassword"
  | "name"
  | "username"
  | "slug"
  | "photo"
  | "cover"
  | "bio"
  | "publicDisplayMessage"
  | "city"
  | "country"
  | "memberType"
  | "intent"
  | "specialties"
  | "onboardingComplete"
  | "isDiscoverable"
  | "isTestAccount"
  | "notificationSoundsEnabled"
  | "notificationVolume"
  | "createdAt"
> & { hasPassword: boolean };

/** Internal select — includes passwordHash to derive hasPassword. Never expose the raw hash. */
const userSelect = {
  id: true,
  email: true,
  emailVerified: true,
  identityVerified: true,
  identityVerificationStatus: true,
  isAdmin: true,
  role: true,
  mustChangePassword: true,
  passwordHash: true,
  name: true,
  username: true,
  slug: true,
  photo: true,
  cover: true,
  bio: true,
  publicDisplayMessage: true,
  city: true,
  country: true,
  memberType: true,
  intent: true,
  specialties: true,
  onboardingComplete: true,
  isDiscoverable: true,
  isTestAccount: true,
  notificationSoundsEnabled: true,
  notificationVolume: true,
  deletedAt: true,
  createdAt: true,
} as const;

type RawSelectedUser = {
  passwordHash: string | null;
  deletedAt: Date | null;
} & Omit<SessionUser, "hasPassword">;

function toSessionUser(raw: RawSelectedUser): SessionUser {
  const { passwordHash, deletedAt, ...rest } = raw;
  void deletedAt;
  return { ...rest, hasPassword: Boolean(passwordHash) };
}

function cookieSecure(): boolean {
  const appUrl = process.env.APP_URL || "";
  if (appUrl.startsWith("https://")) return true;
  if (appUrl.includes("localhost") || appUrl.includes("127.0.0.1")) return false;
  return process.env.NODE_ENV === "production";
}

export async function createSession(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashValue(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash, expiresAt },
  });

  const jar = await cookies();
  jar.set(COOKIE_NAME, encodeCookie(rawToken), {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return rawToken;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (raw) {
    const token = decodeCookie(raw);
    if (token) {
      await prisma.session.deleteMany({ where: { tokenHash: hashValue(token) } });
    }
  }
  jar.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const token = decodeCookie(raw);
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashValue(token) },
    include: { user: { select: userSelect } },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => null);
    return null;
  }
  if (session.user.deletedAt) {
    await destroySession();
    return null;
  }
  return toSessionUser(session.user);
}

/** Revoke every active session for a user (e.g. after a password change). */
export async function invalidateAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    const err = new Error("Unauthorized");
    (err as Error & { status: number }).status = 401;
    throw err;
  }
  return user;
}

export function isAdminUser(user: Pick<SessionUser, "role" | "isAdmin">): boolean {
  return user.role === "ADMIN" || user.isAdmin;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireSessionUser();
  if (!isAdminUser(user)) {
    const err = new Error("Admin only");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
  return user;
}

type NextRouteInput = Pick<
  User,
  "mustChangePassword" | "emailVerified" | "onboardingComplete" | "role" | "isAdmin"
>;

/** Smart post-auth destination. */
export function nextRouteForUser(user: NextRouteInput): string {
  if (user.mustChangePassword) {
    return isAdminUser(user) ? "/admin/change-password" : "/profile/settings#password";
  }
  if (!user.emailVerified) return "/check-email";
  if (!user.onboardingComplete) return "/onboarding";
  return "/explore";
}

/** Accepts either a SessionUser (hasPassword derived) or a full Prisma User row. */
type PublicAccountInput = Pick<
  User,
  | "id"
  | "email"
  | "emailVerified"
  | "identityVerified"
  | "identityVerificationStatus"
  | "role"
  | "isAdmin"
  | "mustChangePassword"
  | "name"
  | "username"
  | "slug"
  | "photo"
  | "onboardingComplete"
  | "intent"
  | "isDiscoverable"
  | "isTestAccount"
  | "notificationSoundsEnabled"
  | "notificationVolume"
> &
  ({ passwordHash: string | null } | { hasPassword: boolean });

export function toPublicAccount(user: PublicAccountInput) {
  const hasPassword =
    "passwordHash" in user ? Boolean(user.passwordHash) : user.hasPassword;
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    identityVerified: user.identityVerified,
    identityVerificationStatus:
      user.identityVerificationStatus ||
      (user.identityVerified ? "VERIFIED" : "UNVERIFIED"),
    role: user.role,
    isAdmin: isAdminUser(user),
    mustChangePassword: user.mustChangePassword,
    hasPassword,
    name: user.name,
    username: user.username,
    slug: user.slug,
    photo: user.photo,
    onboardingComplete: user.onboardingComplete,
    intent: user.intent,
    isDiscoverable: user.isDiscoverable,
    isTestAccount: user.isTestAccount,
    notificationSoundsEnabled: user.notificationSoundsEnabled,
    notificationVolume: user.notificationVolume,
  };
}
