/**
 * Decides whether the Preview Sandbox entry may call the corrected-retry
 * service. The caller cannot supply a key, amount, or recipient.
 * Any other fixture stays off this path.
 */

export const CORRECTED_RETRY_FIXTURE = {
  hostH8: "bf232aa9",
  txnH8: "7162e1e3",
  attemptH8: "d69014c5",
} as const;

export function isExactCorrectedRetryFixture(opts: {
  hostH8: string | null;
  txnH8: string;
  txnStatus: string;
  stripeMode: string;
  attemptCount: number;
  attemptH8: string | null;
  attemptStatus: string | null;
  hasOutboundPaymentId: boolean;
  listedOutboundCount: number | null;
}): boolean {
  return (
    opts.hostH8 === CORRECTED_RETRY_FIXTURE.hostH8 &&
    opts.txnH8 === CORRECTED_RETRY_FIXTURE.txnH8 &&
    opts.attemptH8 === CORRECTED_RETRY_FIXTURE.attemptH8 &&
    opts.txnStatus === "READY_TO_RELEASE" &&
    opts.stripeMode === "TEST" &&
    opts.attemptCount === 1 &&
    opts.attemptStatus === "FAILED" &&
    opts.hasOutboundPaymentId === false &&
    opts.listedOutboundCount === 0
  );
}
