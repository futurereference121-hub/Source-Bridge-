import { createHash } from "crypto";
import { jsonError } from "@/lib/validation";
import { readFinancialAccountBalance } from "@/lib/payments/payout-rail/fa-funding";
import { getGlobalPayoutsFinancialAccountId } from "@/lib/payments/payout-rail/gp-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Temporary read-only probe for the configured TEST financial account.
 * Returns status, account hash, livemode, and parsed GBP minor units only.
 */
function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const cron = (process.env.CRON_SECRET || "").trim();
  const probe = (process.env.GP_FA_PROBE_TOKEN || "").trim();
  if (cron && auth === `Bearer ${cron}`) return true;
  if (probe && auth === `Bearer ${probe}`) return true;
  return false;
}

function accountMatched(failureKind: string | null, rawOk: boolean): boolean {
  return (
    rawOk ||
    failureKind === "mode_mismatch" ||
    failureKind === "missing_currency" ||
    failureKind === "malformed_amount"
  );
}

export async function GET(req: Request) {
  if (!authorized(req)) return jsonError("Unauthorized", 401);
  const configured = getGlobalPayoutsFinancialAccountId("TEST");
  const accountHash = configured
    ? createHash("sha256").update(configured).digest("hex").slice(0, 8)
    : null;
  try {
    const snap = await readFinancialAccountBalance("TEST", "GBP");
    return Response.json({
      ok: snap.rawOk,
      httpStatus: snap.httpStatus,
      accountHash,
      accountMatched: accountMatched(snap.failureKind, snap.rawOk),
      livemode: snap.livemode,
      availableMinor: snap.availableMinor,
      currency: snap.currency,
      failureKind: snap.failureKind,
      errorCode: snap.errorCode,
      errorType: snap.errorType,
    });
  } catch {
    return Response.json(
      {
        ok: false,
        httpStatus: null,
        accountHash,
        accountMatched: false,
        livemode: null,
        availableMinor: null,
        currency: null,
        failureKind: "http",
        errorCode: "request_failed",
        errorType: null,
      },
      { status: 502 },
    );
  }
}
