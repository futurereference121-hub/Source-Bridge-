import { createHash } from "crypto";
import { jsonError } from "@/lib/validation";
import { prisma } from "@/lib/db";
import { gpFetch } from "@/lib/payments/payout-rail/gp-client";
import { getStripe } from "@/lib/payments/stripe/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WANT_TXN = "50bf732e";
const SAFE_TOKEN = /^[a-z0-9_]{1,40}$/i;

function hash8(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function token(value: unknown): string | null {
  return typeof value === "string" && SAFE_TOKEN.test(value.trim()) ? value.trim() : null;
}

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const probe = (process.env.GP_PAYOUT_PROBE_TOKEN || "").trim();
  return Boolean(probe) && auth === `Bearer ${probe}`;
}

type Listed = {
  id: string;
  amountMinor: number | null;
  currency: string;
  metadataTxn: string;
};

function readPage(body: Record<string, unknown>): Listed[] | null {
  if (!Array.isArray(body.data)) return null;
  const rows: Listed[] = [];
  for (const raw of body.data) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const amount =
      row.amount && typeof row.amount === "object"
        ? (row.amount as Record<string, unknown>)
        : {};
    const metadata =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {};
    rows.push({
      id: typeof row.id === "string" ? row.id : "",
      amountMinor: typeof amount.value === "number" && Number.isInteger(amount.value) ? amount.value : null,
      currency: typeof amount.currency === "string" ? amount.currency.toLowerCase() : "",
      metadataTxn: typeof metadata.protectedTxnId === "string" ? metadata.protectedTxnId : "",
    });
  }
  return rows;
}

async function discover(txnId: string, storedOutboundId: string) {
  let path = "/v2/money_management/outbound_payments?limit=100";
  const rows: Listed[] = [];
  for (let page = 0; page < 20; page += 1) {
    const listed = await gpFetch({ mode: "TEST", method: "GET", path });
    if (!listed.ok) {
      return {
        complete: false,
        httpStatus: listed.status,
        errorCode: token((listed.body.error as { code?: unknown } | undefined)?.code),
        pages: page,
        totalListed: rows.length,
        matchCount: 0,
        matchHashes: [] as string[],
        sameAmountCount: 0,
      };
    }
    const batch = readPage(listed.body);
    if (!batch) {
      return {
        complete: false,
        httpStatus: listed.status,
        errorCode: "malformed_list",
        pages: page + 1,
        totalListed: rows.length,
        matchCount: 0,
        matchHashes: [] as string[],
        sameAmountCount: 0,
      };
    }
    rows.push(...batch);
    const next = listed.body.next_page_url;
    if (!next) {
      const matches = rows.filter(
        (row) =>
          (row.metadataTxn && row.metadataTxn === txnId) ||
          (storedOutboundId && row.id === storedOutboundId),
      );
      const distinct = [...new Set(matches.map((row) => row.id).filter(Boolean))];
      return {
        complete: true,
        httpStatus: 200,
        errorCode: null,
        pages: page + 1,
        totalListed: rows.length,
        matchCount: distinct.length,
        matchHashes: distinct.map(hash8),
        sameAmountCount: rows.filter((row) => row.amountMinor === 3500 && row.currency === "gbp").length,
      };
    }
    if (typeof next !== "string" || !next.startsWith("https://api.stripe.com/v2/money_management/outbound_payments")) {
      return {
        complete: false,
        httpStatus: listed.status,
        errorCode: "bad_page",
        pages: page + 1,
        totalListed: rows.length,
        matchCount: 0,
        matchHashes: [] as string[],
        sameAmountCount: 0,
      };
    }
    path = next.slice("https://api.stripe.com".length);
  }
  return {
    complete: false,
    httpStatus: 200,
    errorCode: "page_limit",
    pages: 20,
    totalListed: rows.length,
    matchCount: 0,
    matchHashes: [] as string[],
    sameAmountCount: 0,
  };
}

export async function GET(req: Request) {
  if (!authorized(req)) return jsonError("Unauthorized", 401);
  try {
    const txns = await prisma.protectedTransaction.findMany({
      where: { payoutRail: "STRIPE_GLOBAL_PAYOUTS", stripeMode: "TEST" },
      select: {
        id: true,
        status: true,
        currency: true,
        protectionFeeMinor: true,
        totalChargeMinor: true,
        finalTransferredMinor: true,
        stripePaymentIntentId: true,
        outboundPaymentAttempts: {
          select: {
            id: true,
            status: true,
            stripeOutboundPaymentId: true,
            amountMinor: true,
          },
        },
      },
    });
    const txn = txns.find((row) => hash8(row.id) === WANT_TXN);
    if (!txn) {
      return Response.json({ ok: false, failureKind: "not_found" });
    }
    const attempt = txn.outboundPaymentAttempts.find((row) => hash8(row.id) === "5c061294");
    const outboundId = attempt?.stripeOutboundPaymentId || "";
    const discovery = await discover(txn.id, outboundId);
    let outbound: Record<string, unknown> = { httpStatus: null };
    if (outboundId) {
      const retrieved = await gpFetch({
        mode: "TEST",
        method: "GET",
        path: `/v2/money_management/outbound_payments/${encodeURIComponent(outboundId)}`,
      });
      const amount =
        retrieved.body.amount && typeof retrieved.body.amount === "object"
          ? (retrieved.body.amount as Record<string, unknown>)
          : {};
      outbound = {
        httpStatus: retrieved.status,
        ok: retrieved.ok,
        hash: hash8(outboundId),
        suffix: outboundId.slice(-5),
        livemode: typeof retrieved.body.livemode === "boolean" ? retrieved.body.livemode : null,
        providerStatus: token(retrieved.body.status),
        amountMinor: typeof amount.value === "number" ? amount.value : null,
        currency: typeof amount.currency === "string" ? amount.currency.toLowerCase() : null,
        errorCode: retrieved.ok ? null : token((retrieved.body.error as { code?: unknown } | undefined)?.code),
      };
    }
    let paymentIntent: Record<string, unknown> = { httpStatus: null };
    if (txn.stripePaymentIntentId) {
      try {
        const pi = await getStripe("TEST").paymentIntents.retrieve(txn.stripePaymentIntentId);
        paymentIntent = {
          httpStatus: 200,
          hash: hash8(txn.stripePaymentIntentId),
          suffix: txn.stripePaymentIntentId.slice(-5),
          livemode: pi.livemode,
          amountMinor: pi.amount,
          currency: pi.currency,
          providerStatus: token(pi.status),
        };
      } catch {
        paymentIntent = { httpStatus: null, errorCode: "request_failed" };
      }
    }
    return Response.json({
      ok: true,
      application: {
        txnHash: WANT_TXN,
        status: txn.status,
        currency: txn.currency,
        totalChargeMinor: txn.totalChargeMinor,
        protectionFeeMinor: txn.protectionFeeMinor,
        finalTransferredMinor: txn.finalTransferredMinor,
        attemptHash: attempt ? "5c061294" : null,
        attemptStatus: attempt?.status ?? null,
        attemptAmountMinor: attempt?.amountMinor ?? null,
      },
      discovery,
      outbound,
      paymentIntent,
    });
  } catch {
    return Response.json(
      { ok: false, failureKind: "http", errorCode: "request_failed" },
      { status: 502 },
    );
  }
}
