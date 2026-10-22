import { redirect } from "next/navigation";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import {
  DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
  DASHBOARD_BANK_CONFIRMATION_LIVE_STATEMENT,
  DASHBOARD_BANK_CONFIRMATION_STATEMENT,
} from "@/lib/payments/payout-rail/platform-balance";
import ConfirmGbpBankButton from "./confirm-gbp-bank-button";
import ConfirmLiveGbpBankButton from "./confirm-live-gbp-bank-button";

export default async function PlatformBalanceAdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/sign-in");
  if (!isAdminUser(user)) redirect("/explore");
  if (user.mustChangePassword) redirect("/admin/change-password");

  return (
    <>
      <h1 className="mt-2 font-display text-4xl">Platform balance</h1>
      <p className="mt-4 max-w-2xl text-sm text-white/70">
        Opening this page does not record a confirmation, change the daily payout schedule,
        or enable funding or payouts. TEST and LIVE confirmations are stored separately.
      </p>
      <section className="mt-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-electric">
          Test mode
        </p>
        <p className="mt-6 max-w-2xl rounded-xl border border-white/10 bg-white/5 p-5 text-sm leading-6">
          {DASHBOARD_BANK_CONFIRMATION_STATEMENT}
        </p>
        <ConfirmGbpBankButton
          statement={DASHBOARD_BANK_CONFIRMATION_STATEMENT}
          evidence={DASHBOARD_BANK_CONFIRMATION_EVIDENCE}
        />
      </section>
      <section className="mt-12">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-electric">
          Live mode
        </p>
        <p className="mt-6 max-w-2xl rounded-xl border border-white/10 bg-white/5 p-5 text-sm leading-6">
          {DASHBOARD_BANK_CONFIRMATION_LIVE_STATEMENT}
        </p>
        <ConfirmLiveGbpBankButton
          statement={DASHBOARD_BANK_CONFIRMATION_LIVE_STATEMENT}
          evidence={DASHBOARD_BANK_CONFIRMATION_EVIDENCE}
        />
      </section>
    </>
  );
}
