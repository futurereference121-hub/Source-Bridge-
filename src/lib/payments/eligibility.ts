import { isAdminUser, type SessionUser } from "@/lib/auth";

export type PartyUser = {
  id: string;
  isDemo: boolean;
  isTestAccount: boolean;
  isAdmin: boolean;
  role: string;
  username: string | null;
  deletedAt: Date | null;
  trustLevel: number;
  procurementAdvancesEnabled: boolean;
  identityVerified: boolean;
};

export function isAdminsource(user: Pick<PartyUser, "username" | "role" | "isAdmin">): boolean {
  return (
    (user.username || "").toLowerCase() === "adminsource" ||
    user.role === "ADMIN" ||
    user.isAdmin
  );
}

/**
 * Demo / showcase / adminsource / deleted accounts must never create, fund,
 * or receive real protected transactions.
 */
export function assertEligiblePaymentParty(
  user: PartyUser,
  role: "buyer" | "seller",
): void {
  if (user.deletedAt) {
    throw Object.assign(new Error("Account is deleted"), {
      status: 403,
      code: "ACCOUNT_DELETED",
    });
  }
  if (user.isDemo) {
    throw Object.assign(
      new Error(
        "Showcase profiles cannot participate in Protected Payments.",
      ),
      { status: 403, code: "DEMO_BLOCKED" },
    );
  }
  if (user.isTestAccount) {
    throw Object.assign(
      new Error("Test accounts cannot participate in Protected Payments."),
      { status: 403, code: "TEST_ACCOUNT_BLOCKED" },
    );
  }
  if (isAdminsource(user)) {
    throw Object.assign(
      new Error("Admin accounts cannot buy or sell via Protected Payments."),
      { status: 403, code: "ADMIN_BLOCKED" },
    );
  }
  if (role === "seller" && !user.identityVerified) {
    // Soft gate documented — Connect onboarding still required separately.
  }
}

export function assertNotSelfTrade(buyerId: string, sellerId: string): void {
  if (buyerId === sellerId) {
    throw Object.assign(new Error("Buyer and seller must be different"), {
      status: 400,
      code: "SELF_TRADE",
    });
  }
}

export type ProcurementEligibilityInput = {
  globallyEnabled: boolean;
  featureFlagOn: boolean;
  seller: Pick<
    PartyUser,
    "trustLevel" | "procurementAdvancesEnabled" | "isDemo" | "isAdmin" | "role" | "username"
  >;
  minTrustLevel: number;
  paymentOption: "PROTECTED" | "INSTANT";
  agreed: boolean;
};

/**
 * Recorded original luckyday trust for the TEST GP procurement pass.
 * Restore by disabling GP_TEST_PROCUREMENT_TRUST_OVERRIDE — do not write this.
 */
export const TEST_GP_PROCUREMENT_TRUST_ORIGINAL = 0;

/**
 * Raise effective trust for TEST tickets only. LIVE and non-sandbox sellers
 * keep the stored User.trustLevel.
 */
export function applyTestProcurementTrustOverride(opts: {
  storedTrustLevel: number;
  minTrustLevel: number;
  stripeMode?: "TEST" | "LIVE" | null;
  sellerIsApprovedTestSourcer: boolean;
  overrideEnabled: boolean;
}): number {
  if (
    opts.overrideEnabled &&
    opts.stripeMode === "TEST" &&
    opts.sellerIsApprovedTestSourcer
  ) {
    return Math.max(opts.storedTrustLevel, opts.minTrustLevel);
  }
  return opts.storedTrustLevel;
}

export function procurementAvailabilityReason(
  input: Omit<ProcurementEligibilityInput, "agreed">,
): string | null {
  if (!input.featureFlagOn || !input.globallyEnabled) return "PROCUREMENT_DISABLED";
  if (input.paymentOption === "INSTANT") return "DIRECT_NO_PROCUREMENT";
  if (!input.seller.procurementAdvancesEnabled) return "SELLER_PROCUREMENT_DISABLED";
  if (input.seller.isDemo || isAdminsource(input.seller)) return "SELLER_NOT_ELIGIBLE";
  if (input.seller.trustLevel < input.minTrustLevel) return "SELLER_TRUST";
  return null;
}

export function procurementIneligibilityReason(
  input: ProcurementEligibilityInput,
): string | null {
  if (!input.agreed) return null;
  return procurementAvailabilityReason(input);
}

export function procurementAvailabilityCopy(
  reason: string | null,
  minTrustLevel: number,
): string | null {
  if (reason === "SELLER_TRUST") {
    return `Procurement advance needs sourcer trust level ${minTrustLevel} or higher.`;
  }
  if (reason === "SELLER_PROCUREMENT_DISABLED" || reason === "SELLER_NOT_ELIGIBLE") {
    return "Procurement advance is not available for this sourcer.";
  }
  if (reason === "PROCUREMENT_DISABLED") {
    return "Procurement advances are not available right now.";
  }
  if (reason === "DIRECT_NO_PROCUREMENT") {
    return "Procurement advance is only available on Protected Payment.";
  }
  return null;
}

export function isProcurementEligible(input: ProcurementEligibilityInput): boolean {
  return procurementIneligibilityReason(input) == null && input.agreed;
}

export function sessionToParty(
  user: SessionUser & {
    deletedAt?: Date | null;
    trustLevel?: number;
    procurementAdvancesEnabled?: boolean;
  },
): PartyUser {
  return {
    id: user.id,
    isDemo: Boolean(user.isDemo),
    isTestAccount: Boolean(user.isTestAccount),
    isAdmin: isAdminUser(user),
    role: user.role,
    username: user.username,
    deletedAt: user.deletedAt ?? null,
    trustLevel: user.trustLevel ?? 0,
    procurementAdvancesEnabled: user.procurementAdvancesEnabled ?? true,
    identityVerified: Boolean(user.identityVerified),
  };
}
