/**
 * Pure password-strength logic with no Node built-ins — safe to import from
 * client components (join / set-password forms) as well as server code.
 * Actual hashing lives in @/lib/password (server-only, uses node:crypto).
 */

const COMMON_PASSWORDS = new Set(
  [
    "password",
    "password1",
    "password12",
    "password123",
    "1234567890",
    "qwertyuiop",
    "abcdefghij",
    "letmein123",
    "welcome123",
    "sourcebridge",
    "sourcebridge1",
    "admin12345",
    "iloveyou12",
  ].map((p) => p.toLowerCase()),
);

/** Member password policy: min 10, upper, lower, digit; symbols allowed. */
export function validatePasswordStrength(plain: string): string | null {
  if (plain.length < 10) return "Password must be at least 10 characters.";
  if (plain.length > 128) return "Password is too long.";
  if (!/[a-z]/.test(plain)) return "Password must include a lowercase letter.";
  if (!/[A-Z]/.test(plain)) return "Password must include an uppercase letter.";
  if (!/\d/.test(plain)) return "Password must include a number.";
  if (COMMON_PASSWORDS.has(plain.toLowerCase())) {
    return "Choose a stronger password — this one is too common.";
  }
  if (/^(.)\1+$/.test(plain)) {
    return "Password cannot be a single repeated character.";
  }
  return null;
}

export type PasswordStrengthLevel = "weak" | "fair" | "good" | "strong";

export function passwordStrengthLevel(plain: string): PasswordStrengthLevel {
  let score = 0;
  if (plain.length >= 10) score += 1;
  if (plain.length >= 14) score += 1;
  if (/[a-z]/.test(plain) && /[A-Z]/.test(plain)) score += 1;
  if (/\d/.test(plain)) score += 1;
  if (/[^A-Za-z0-9]/.test(plain)) score += 1;
  if (score <= 2) return "weak";
  if (score === 3) return "fair";
  if (score === 4) return "good";
  return "strong";
}
