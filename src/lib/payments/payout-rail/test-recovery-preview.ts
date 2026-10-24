/**
 * Read-only TEST recovery plan for the damaged GP purchase (hash b8444fb7).
 * Does not create a top-up, funding payout, quote, or outbound payment.
 */

export const DAMAGED_GP_TEST_PURCHASE = {
  txnHash: "b8444fb7",
  siblingHash: "597151ee",
  buyerHash: "705e5c58",
  sourcerHash: "87a7abb2",
  stripeMode: "TEST" as const,
  payoutRail: "STRIPE_GLOBAL_PAYOUTS",
  currency: "GBP",
  totalChargeMinor: 4025,
  principalMinor: 3500,
  payoutFeeMinor: 138,
  chargeNetMinor: 3904,
  requiredMinor: 3638,
  leftoverAvailableMinor: 266,
  siblingConsumedMinor: 3638,
};

export type RecoveryMembership = "clear" | "paid_out" | "unread";

export type RecoveryOptionId =
  | "reconcile_sibling_pending_leg"
  | "restore_test_card_room"
  | "leave_short_keep_obligation"
  | "substitute_fa_credit";

export type RecoveryOption = {
  id: RecoveryOptionId;
  supported: boolean;
  moneyMovement: boolean;
  ownChargeProof: false;
  amountMinor: number;
  audit: string;
};

export type DamagedRecoveryPlan = {
  purchaseHash: "b8444fb7";
  siblingHash: "597151ee";
  stripeMode: "TEST";
  liveInitiationEnabled: false;
  chargeNetMinor: number;
  principalMinor: number;
  payoutFeeMinor: number;
  requiredMinor: number;
  postedMinor: number;
  pendingMinor: number;
  unpaidMinor: number;
  leftoverAvailableMinor: number;
  siblingConsumedMinor: number;
  siblingPendingLegMinor: number;
  minimumRestoreMinor: number;
  restoreCardMinor: number;
  membershipState: RecoveryMembership;
  canOwnChargeFundAfterRestore: boolean;
  recommended: RecoveryOptionId[];
  options: RecoveryOption[];
};

export function planDamagedGpTestRecovery(input: {
  membershipState: RecoveryMembership;
  postedMinor: number;
  pendingMinor: number;
  leftoverAvailableMinor: number;
  siblingPendingLegMinor: number;
  liveInitiationEnabled?: boolean;
}): DamagedRecoveryPlan {
  const chargeNetMinor = DAMAGED_GP_TEST_PURCHASE.chargeNetMinor;
  const principalMinor = DAMAGED_GP_TEST_PURCHASE.principalMinor;
  const payoutFeeMinor = DAMAGED_GP_TEST_PURCHASE.payoutFeeMinor;
  const requiredMinor = principalMinor + payoutFeeMinor;
  const leftoverAvailableMinor = input.leftoverAvailableMinor;
  const siblingConsumedMinor = DAMAGED_GP_TEST_PURCHASE.siblingConsumedMinor;
  const unpaidMinor = chargeNetMinor - input.postedMinor - input.pendingMinor;
  const minimumRestoreMinor = Math.max(0, requiredMinor - leftoverAvailableMinor);
  const restoreCardMinor = siblingConsumedMinor;
  const liveInitiationEnabled = input.liveInitiationEnabled === true;
  const siblingPendingBlocksRoom = input.siblingPendingLegMinor > 0;
  const canOwnChargeFundAfterRestore =
    input.membershipState === "clear" &&
    !liveInitiationEnabled &&
    input.postedMinor === 0 &&
    input.pendingMinor === 0 &&
    unpaidMinor === chargeNetMinor &&
    leftoverAvailableMinor + restoreCardMinor >= requiredMinor &&
    !siblingPendingBlocksRoom;

  const options: RecoveryOption[] = [
    {
      id: "reconcile_sibling_pending_leg",
      supported: siblingPendingBlocksRoom,
      moneyMovement: false,
      ownChargeProof: false,
      amountMinor: input.siblingPendingLegMinor,
      audit:
        "Retrieve-only: if the sibling funding payout is already paid, persist POSTED. Do not create a payout. Keep the sibling RELEASED / SUCCEEDED row.",
    },
    {
      id: "restore_test_card_room",
      supported: input.membershipState === "clear" && !liveInitiationEnabled,
      moneyMovement: restoreCardMinor > 0,
      ownChargeProof: false,
      amountMinor: restoreCardMinor,
      audit:
        "TEST platform card top-up of 3638 replaces the amount the sibling consumed. Minimum to reach required after leftover 266 is 3372. Not a customer PaymentIntent. Worker then funds this purchase against its own charge.",
    },
    {
      id: "leave_short_keep_obligation",
      supported: true,
      moneyMovement: false,
      ownChargeProof: false,
      amountMinor: unpaidMinor,
      audit:
        "Keep SHORT / GP_FUNDING_ROOM. Do not mark paid_out. Do not zero chargeNet. A later own-charge proof must be a different purchase.",
    },
    {
      id: "substitute_fa_credit",
      supported: input.membershipState === "paid_out",
      moneyMovement: true,
      ownChargeProof: false,
      amountMinor: requiredMinor,
      audit:
        "Only if membership is paid_out so own-charge funding is impossible. TEST FA credit attached to this purchase. Substitute repair, not own-charge proof.",
    },
  ];

  const recommended: RecoveryOptionId[] = [];
  if (siblingPendingBlocksRoom) recommended.push("reconcile_sibling_pending_leg");
  if (input.membershipState === "unread") recommended.push("leave_short_keep_obligation");
  else if (canOwnChargeFundAfterRestore || input.membershipState === "clear") {
    recommended.push("restore_test_card_room");
  } else if (input.membershipState === "paid_out") {
    recommended.push("substitute_fa_credit");
    recommended.push("leave_short_keep_obligation");
  } else {
    recommended.push("leave_short_keep_obligation");
  }

  return {
    purchaseHash: "b8444fb7",
    siblingHash: "597151ee",
    stripeMode: "TEST",
    liveInitiationEnabled: false,
    chargeNetMinor,
    principalMinor,
    payoutFeeMinor,
    requiredMinor,
    postedMinor: input.postedMinor,
    pendingMinor: input.pendingMinor,
    unpaidMinor,
    leftoverAvailableMinor,
    siblingConsumedMinor,
    siblingPendingLegMinor: input.siblingPendingLegMinor,
    minimumRestoreMinor,
    restoreCardMinor,
    membershipState: input.membershipState,
    canOwnChargeFundAfterRestore,
    recommended,
    options,
  };
}
