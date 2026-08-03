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

export function isProcurementEligible(input: ProcurementEligibilityInput): boolean {
  if (!input.featureFlagOn || !input.globallyEnabled) return false;
  if (!input.agreed) return false;
  if (input.paymentOption === "INSTANT") return false;
  if (!input.seller.procurementAdvancesEnabled) return false;
  if (input.seller.isDemo || isAdminsource(input.seller)) return false;
  return input.seller.trustLevel >= input.minTrustLevel;
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
