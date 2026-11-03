/**
 * Admin GP vs Connect release copy and confirmation state.
 * Run: node scripts/test-admin-release-display.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function formatGbp(minor) {
  const pounds = Math.trunc(minor / 100);
  const pence = String(minor % 100).padStart(2, "0");
  return `£${pounds}.${pence}`;
}

function isGlobalPayoutsRail(rail) {
  return String(rail || "").trim().toUpperCase() === "STRIPE_GLOBAL_PAYOUTS";
}

function adminConfirmReleaseSentence(opts) {
  const amount = formatGbp(opts.releaseMinor);
  if (isGlobalPayoutsRail(opts.payoutRail)) {
    return `Release ${amount} to the seller via Global Payouts.`;
  }
  return `Release ${amount} to the seller Connect account.`;
}

function adminPayoutPhaseFromOutbound(status) {
  const s = String(status || "").trim().toUpperCase();
  if (s === "SUCCEEDED" || s === "RECONCILED") return "sent";
  if (s === "FAILED" || s === "RETURNED") return "failed";
  if (!s) return "none";
  return "pending";
}

function deriveAdminReleaseDecisionView(opts) {
  const transferred = Math.max(0, Math.trunc(opts.alreadyReleasedMinor || 0));
  const outboundAuthorized = Math.max(0, Math.trunc(opts.authorizedReleaseMinor || 0));
  const gp = isGlobalPayoutsRail(opts.payoutRail);
  const authorizedMinor = gp ? Math.max(transferred, outboundAuthorized) : transferred;
  const payoutPhase = gp
    ? adminPayoutPhaseFromOutbound(opts.outboundStatus)
    : authorizedMinor > 0 && opts.finalResidualMinor <= 0
      ? "sent"
      : authorizedMinor > 0
        ? "pending"
        : "none";
  const decisionLocked = gp
    ? outboundAuthorized > 0 || (authorizedMinor > 0 && opts.finalResidualMinor <= 0)
    : opts.finalResidualMinor <= 0 && authorizedMinor > 0;
  return {
    decisionLocked,
    authorizedMinor,
    confirmedCopy: decisionLocked ? `Release confirmed: ${formatGbp(authorizedMinor || outboundAuthorized || transferred)}` : null,
    payoutPhase,
    payoutCopy:
      payoutPhase === "pending"
        ? "Payout pending"
        : payoutPhase === "sent"
          ? "Payout sent"
          : payoutPhase === "failed"
            ? "Payout failed"
            : null,
  };
}

const helper = read("src/lib/payments/admin-release-display.ts");
assert.match(helper, /Release \$\{amount\} to the seller via Global Payouts/);
assert.match(helper, /Release \$\{amount\} to the seller Connect account/);
assert.match(helper, /Release confirmed:/);
assert.match(helper, /Payout pending/);
assert.match(helper, /decisionLocked/);

assert.equal(
  adminConfirmReleaseSentence({
    payoutRail: "STRIPE_GLOBAL_PAYOUTS",
    releaseMinor: 2500,
  }),
  "Release £25.00 to the seller via Global Payouts.",
);
assert.equal(
  adminConfirmReleaseSentence({
    payoutRail: "STRIPE_CONNECT",
    releaseMinor: 2500,
  }),
  "Release £25.00 to the seller Connect account.",
);

const gpPending = deriveAdminReleaseDecisionView({
  payoutRail: "STRIPE_GLOBAL_PAYOUTS",
  alreadyReleasedMinor: 0,
  finalResidualMinor: 2500,
  authorizedReleaseMinor: 2500,
  outboundStatus: "AWAITING_FA_FUNDS",
});
assert.equal(gpPending.decisionLocked, true);
assert.equal(gpPending.confirmedCopy, "Release confirmed: £25.00");
assert.equal(gpPending.payoutPhase, "pending");
assert.equal(gpPending.payoutCopy, "Payout pending");

const gpOpen = deriveAdminReleaseDecisionView({
  payoutRail: "STRIPE_GLOBAL_PAYOUTS",
  alreadyReleasedMinor: 0,
  finalResidualMinor: 2500,
  authorizedReleaseMinor: 0,
  outboundStatus: null,
});
assert.equal(gpOpen.decisionLocked, false);

const connectDone = deriveAdminReleaseDecisionView({
  payoutRail: "STRIPE_CONNECT",
  alreadyReleasedMinor: 2500,
  finalResidualMinor: 0,
  authorizedReleaseMinor: 0,
  outboundStatus: null,
});
assert.equal(connectDone.decisionLocked, true);
assert.equal(connectDone.payoutPhase, "sent");

const issueActions = read("src/app/admin/payments/issue-actions.tsx");
assert.match(issueActions, /adminConfirmReleaseSentence/);
assert.match(issueActions, /deriveAdminReleaseDecisionView/);
assert.match(issueActions, /adminReleaseConfirmedCopy/);
assert.match(issueActions, /setBusy\(true\)/);
assert.doesNotMatch(
  issueActions,
  /to the seller Connect account`/,
);

const listed = read("src/app/admin/payments/listed-purchases-section.tsx");
assert.match(listed, /payoutRail/);
assert.match(listed, /authorizedReleaseMinor/);

const patch = read("src/app/api/admin/payments/protected-txns/route.ts");
assert.match(patch, /releaseAuthorizedMinor/);
assert.match(patch, /payoutPhase/);

console.log("test-admin-release-display: OK");
