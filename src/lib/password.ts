import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export function validatePasswordStrength(plain: string): string | null {
  if (plain.length < 12) return "Password must be at least 12 characters.";
  if (!/[a-z]/.test(plain)) return "Password must include a lowercase letter.";
  if (!/[A-Z]/.test(plain)) return "Password must include an uppercase letter.";
  if (!/\d/.test(plain)) return "Password must include a digit.";
  if (!/[^A-Za-z0-9]/.test(plain)) return "Password must include a symbol.";
  return null;
}

export async function hashPassword(plain: string): Promise<string> {
  const error = validatePasswordStrength(plain);
  if (error) throw new Error(error);
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(plain, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  try {
    const expected = Buffer.from(digest, "hex");
    const actual = (await scrypt(plain, salt, expected.length)) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function generateTemporaryPassword(): string {
  // 20 random bytes provides substantial entropy; fixed class prefixes satisfy policy.
  return `A!a1${randomBytes(20).toString("base64url")}`;
}
