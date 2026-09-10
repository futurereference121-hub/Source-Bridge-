/**
 * Whether a member may display an active Trust Passport endorsement.
 * Restricted / non-genuine accounts get no Bronze/Silver/Gold shield.
 */

export type EndorsementEligibilityInput = {
  deletedAt?: Date | string | null;
  isDemo?: boolean | null;
  isTestAccount?: boolean | null;
  isExample?: boolean | null;
  isPrototype?: boolean | null;
  isRealAccount?: boolean | null;
  isAdmin?: boolean | null;
  role?: string | null;
  id?: string | null;
};

export function isTrustPassportEndorsementAvailable(
  user: EndorsementEligibilityInput,
): boolean {
  if (user.deletedAt) return false;
  if (user.isDemo) return false;
  if (user.isTestAccount) return false;
  if (user.isExample) return false;
  if (user.isPrototype) return false;
  if (user.isRealAccount === false) return false;
  if (user.isAdmin) return false;
  if ((user.role || "").toUpperCase() === "ADMIN") return false;
  const id = user.id || "";
  if (id.startsWith("m-") || id.startsWith("example-")) return false;
  return true;
}
