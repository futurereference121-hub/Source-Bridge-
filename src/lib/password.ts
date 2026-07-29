import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { validatePasswordStrength } from "@/lib/password-strength";

export { validatePasswordStrength } from "@/lib/password-strength";
export type { PasswordStrengthLevel } from "@/lib/password-strength";
export { passwordStrengthLevel } from "@/lib/password-strength";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(plain: string): Promise<string> {
  const error = validatePasswordStrength(plain);
  if (error) throw new Error(error);
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(plain, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

/** Hash without strength check — for regenerating known-good admin temps only. */
export async function hashPasswordUnchecked(plain: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(plain, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
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
  return `A!a1${randomBytes(20).toString("base64url")}`;
}
