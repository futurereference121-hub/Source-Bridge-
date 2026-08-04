import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { getStripeMode, isPaymentsEnabled } from "@/lib/payments/flags";
import { markTxnFundedFromWebhook } from "@/lib/payments/checkout";
import { recordAuditEvent } from "@/lib/payments/ledger";
import {
  getStripe,
  getStripeConnectWebhookSecrets,
  getStripeWebhookSecrets,
  hasStripeTestSecretKey,
} from "@/lib/payments/stripe/client";
import { syncConnectAccountByStripeId } from "@/lib/payments/stripe/connect";

/**
 * Accounts v2 Connect event model (Stripe 2024–2026 / Accounts v2):
 *
 * v2 Account objects for connected sellers emit BOTH:
 * - Thin events (`object: "v2.core.event"`) — scope **Your account**
 * - Classic snapshot events such as `account.updated` — scope **Connected accounts**
 *
 * Thin events are property-specific for merchant/recipient/requirements; they do
 * NOT all collapse into a single `v2.core.account.updated` (that fires only for
 * top-level fields like dashboard / display_name).
 *
 * After any thin connect notification we re-fetch the account (v1 retrieve is
 * compatible with v2 Account ids) and update local non-financial status.
 *
 * Payment Intents for Separate Charges and Transfers are platform objects →
 * snapshot events with scope **Your account**.
 */

/** Platform destination: Your account, snapshot format. */
export const PLATFORM_WEBHOOK_EVENTS = [
  "payment_intent.succeeded",
] as const;

/**
 * Connect destination (preferred): Your account, thin v2 format.
 * Maps seller lifecycle → begin onboard / submit / restricted / eligible / disabled.
 */
export const CONNECT_THIN_WEBHOOK_EVENTS = [
  "v2.core.account.created",
  "v2.core.account.updated",
  "v2.core.account.closed",
  "v2.core.account[configuration.merchant].updated",
  "v2.core.account[configuration.merchant].capability_status_updated",
  "v2.core.account[configuration.recipient].updated",
  "v2.core.account[configuration.recipient].capability_status_updated",
  "v2.core.account[requirements].updated",
  "v2.core.account[future_requirements].updated",
  "v2.core.account[identity].updated",
  "v2.core.account[defaults].updated",
  "v2.core.account_link.returned",
] as const;

/**
 * Optional companion destination: Connected accounts, snapshot format.
 * Still emitted for v2 Accounts when merchant/recipient configuration changes.
 */
export const CONNECT_SNAPSHOT_WEBHOOK_EVENTS = ["account.updated"] as const;

export type WebhookRouteKind = "platform" | "connect";

type ThinEventNotification = {
  id: string;
  object: "v2.core.event";
  type: string;
  livemode: boolean;
  related_object?: { id?: string; type?: string; url?: string } | null;
};

type VerifiedPayload =
  | { kind: "snapshot"; event: Stripe.Event }
  | { kind: "thin"; event: ThinEventNotification };

function isThinNotification(payload: unknown): payload is ThinEventNotification {
  if (!payload || typeof payload !== "object") return false;
  const o = payload as Record<string, unknown>;
  return (
    o.object === "v2.core.event" &&
    typeof o.id === "string" &&
    typeof o.type === "string"
  );
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Verify Stripe-Signature against one or more endpoint secrets.
 * Returns 400-ready error when none match; never logs the secret or payload body.
 */
export function constructStripeWebhookEvent(
  rawBody: string,
  signatureHeader: string,
  secrets: string[],
): VerifiedPayload {
  const list = uniqueNonEmpty(secrets);
  if (!list.length) {
    throw Object.assign(new Error("Webhook secret not configured"), {
      status: 503,
      code: "WEBHOOK_SECRET_MISSING",
    });
  }
  if (!signatureHeader) {
    throw Object.assign(new Error("Invalid signature"), {
      status: 400,
      code: "WEBHOOK_SIG_INVALID",
    });
  }

  // constructEvent only needs crypto helpers from the Stripe instance; avoid
  // requiring PAYMENTS_ENABLED. Key is only needed for API calls after verify.
  const stripe = hasStripeTestSecretKey()
    ? getStripe()
    : new Stripe("sk_test_webhook_verify_only", { typescript: true });

  let lastErr: unknown;
  for (const secret of list) {
    try {
      const parsed = stripe.webhooks.constructEvent(rawBody, signatureHeader, secret) as
        | Stripe.Event
        | ThinEventNotification
        | Record<string, unknown>;
      if (isThinNotification(parsed)) {
        return { kind: "thin", event: parsed };
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as Stripe.Event).object === "event" &&
        typeof (parsed as Stripe.Event).id === "string" &&
        typeof (parsed as Stripe.Event).type === "string"
      ) {
        return { kind: "snapshot", event: parsed as Stripe.Event };
      }
      // Verified JSON that does not match known shapes — treat as unsupported thin-ish
      const id = typeof (parsed as { id?: unknown }).id === "string"
        ? (parsed as { id: string }).id
        : "";
      const type = typeof (parsed as { type?: unknown }).type === "string"
        ? (parsed as { type: string }).type
        : "unknown";
      if (!id) {
        throw Object.assign(new Error("Invalid event payload"), {
          status: 400,
          code: "WEBHOOK_PAYLOAD_INVALID",
        });
      }
      return {
        kind: "thin",
        event: {
          id,
          object: "v2.core.event",
          type,
          livemode: Boolean((parsed as { livemode?: boolean }).livemode),
          related_object: (parsed as ThinEventNotification).related_object ?? null,
        },
      };
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      if (status === 400 || status === 503) throw err;
      // Signature mismatch — try next secret
    }
  }
  void lastErr;
  throw Object.assign(new Error("Invalid signature"), {
    status: 400,
    code: "WEBHOOK_SIG_INVALID",
  });
}

function secretsForRoute(route: WebhookRouteKind): string[] {
  if (route === "connect") {
    // Prefer Connect secrets; fall back to platform secret so a single
    // destination can temporarily be pointed at the connect URL during migration.
    return uniqueNonEmpty([
      ...getStripeConnectWebhookSecrets(),
      ...getStripeWebhookSecrets(),
    ]);
  }
  return getStripeWebhookSecrets();
}

function eventMeta(verified: VerifiedPayload): {
  id: string;
  type: string;
  livemode: boolean;
} {
  if (verified.kind === "snapshot") {
    return {
      id: verified.event.id,
      type: verified.event.type,
      livemode: Boolean(verified.event.livemode),
    };
  }
  return {
    id: verified.event.id,
    type: verified.event.type,
    livemode: Boolean(verified.event.livemode),
  };
}

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const existing = await prisma.processedWebhookEvent.findUnique({
    where: { provider_eventId: { provider: "stripe", eventId } },
  });
  return Boolean(existing);
}

async function markProcessed(eventId: string, eventType: string) {
  try {
    await prisma.processedWebhookEvent.create({
      data: {
        provider: "stripe",
        eventId,
        eventType,
        stripeMode: getStripeMode(),
      },
    });
  } catch (err) {
    // Race: concurrent delivery — treat unique violation as success (idempotent).
    const code = (err as { code?: string })?.code;
    if (code === "P2002") return;
    throw err;
  }
}

function isConnectThinType(type: string): boolean {
  return (
    type.startsWith("v2.core.account") ||
    type === "v2.core.account_link.returned"
  );
}

async function handlePaymentIntentSucceeded(
  pi: {
    id: string;
    amount: number;
    currency: string;
    livemode?: boolean;
    latest_charge?: string | null;
  },
  eventId: string,
) {
  if (!isPaymentsEnabled()) {
    await recordAuditEvent({
      action: "STRIPE_WEBHOOK_SKIPPED_PAYMENTS_DISABLED",
      meta: {
        type: "payment_intent.succeeded",
        eventId,
        paymentIntentId: pi.id,
      },
    });
    return { action: "skipped_payments_disabled" as const };
  }
  const result = await markTxnFundedFromWebhook({
    paymentIntentId: pi.id,
    chargeId: typeof pi.latest_charge === "string" ? pi.latest_charge : undefined,
    amountMinor: pi.amount,
    currency: pi.currency,
    eventId,
  });
  return { action: "funded" as const, result };
}

async function handleConnectAccountSync(
  stripeAccountId: string | null | undefined,
  eventId: string,
  eventType: string,
) {
  if (!stripeAccountId) {
    await recordAuditEvent({
      action: "STRIPE_CONNECT_WEBHOOK_NO_ACCOUNT_ID",
      meta: { eventId, eventType },
    });
    return { action: "no_account_id" as const };
  }
  if (!hasStripeTestSecretKey()) {
    await recordAuditEvent({
      action: "STRIPE_CONNECT_WEBHOOK_NO_API_KEY",
      meta: { eventId, eventType, stripeAccountId },
    });
    return { action: "no_api_key" as const };
  }
  try {
    const synced = await syncConnectAccountByStripeId(stripeAccountId, {
      allowWhenPaymentsDisabled: true,
      eventId,
      eventType,
    });
    return {
      action: synced ? ("synced" as const) : ("unknown_account" as const),
      stripeAccountId,
    };
  } catch (err) {
    await recordAuditEvent({
      action: "STRIPE_CONNECT_WEBHOOK_SYNC_FAILED",
      meta: {
        eventId,
        eventType,
        stripeAccountId,
        error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      },
    });
    throw err;
  }
}

/**
 * Core POST pipeline for both platform and Connect webhook routes.
 * Signature verify + idempotency work without PAYMENTS_ENABLED.
 * Money movement / funding only when PAYMENTS_ENABLED.
 */
export async function handleStripeWebhookPost(
  req: Request,
  route: WebhookRouteKind,
): Promise<Response> {
  const secrets = secretsForRoute(route);
  if (!secrets.length) {
    console.error(`[stripe:webhook:${route}] missing webhook secret`);
    return new Response("Webhook secret not configured", { status: 503 });
  }

  const raw = await req.text();
  const signature = req.headers.get("stripe-signature") || "";

  let verified: VerifiedPayload;
  try {
    verified = constructStripeWebhookEvent(raw, signature, secrets);
  } catch (err) {
    const status = (err as { status?: number }).status || 400;
    if (status === 503) {
      return new Response("Webhook secret not configured", { status: 503 });
    }
    return new Response("Invalid signature", { status: 400 });
  }

  const { id: eventId, type: eventType, livemode } = eventMeta(verified);

  // LIVE_PAYMENTS_ENABLED stays false — never process live mode traffic.
  if (livemode) {
    await recordAuditEvent({
      action: "STRIPE_WEBHOOK_LIVE_MODE_REJECTED",
      meta: { eventId, eventType, route },
    });
    // 2xx so Stripe does not retry forever; we refuse to act on live data.
    if (!(await alreadyProcessed(eventId))) {
      await markProcessed(eventId, eventType);
    }
    return Response.json({
      ok: true,
      rejected: "live_mode",
      eventId,
    });
  }

  if (await alreadyProcessed(eventId)) {
    return Response.json({ ok: true, duplicate: true, eventId });
  }

  try {
    let handlerResult: unknown = { action: "ignored" };

    if (verified.kind === "snapshot") {
      const event = verified.event;
      switch (event.type) {
        case "payment_intent.succeeded": {
          if (route === "connect") {
            // Connect route should not fund — ack without money movement.
            await recordAuditEvent({
              action: "STRIPE_WEBHOOK_IGNORED",
              meta: {
                type: event.type,
                eventId,
                reason: "wrong_route",
                route,
              },
            });
            break;
          }
          const pi = event.data.object as {
            id: string;
            amount: number;
            currency: string;
            latest_charge?: string | null;
          };
          handlerResult = await handlePaymentIntentSucceeded(pi, event.id);
          break;
        }
        case "account.updated": {
          const account = event.data.object as {
            id: string;
            metadata?: { sourceBridgeUserId?: string };
          };
          handlerResult = await handleConnectAccountSync(
            account.id,
            event.id,
            event.type,
          );
          break;
        }
        default:
          await recordAuditEvent({
            action: "STRIPE_WEBHOOK_IGNORED",
            meta: { type: event.type, eventId: event.id, route, kind: "snapshot" },
          });
          handlerResult = { action: "ignored", type: event.type };
      }
    } else {
      const thin = verified.event;
      if (isConnectThinType(thin.type)) {
        // account_link.returned uses related_object (account_link), not account id.
        // Prefer related_object when it is an account; otherwise skip fetch — status
        // will refresh on subsequent account.* events.
        let accountId: string | undefined;
        if (thin.related_object?.type === "v2.core.account" && thin.related_object.id) {
          accountId = thin.related_object.id;
        } else if (
          thin.type !== "v2.core.account_link.returned" &&
          thin.related_object?.id?.startsWith("acct_")
        ) {
          accountId = thin.related_object.id;
        }
        if (accountId) {
          handlerResult = await handleConnectAccountSync(
            accountId,
            thin.id,
            thin.type,
          );
        } else {
          await recordAuditEvent({
            action: "STRIPE_CONNECT_THIN_ACK",
            meta: {
              eventId: thin.id,
              eventType: thin.type,
              relatedType: thin.related_object?.type || null,
            },
          });
          handlerResult = { action: "thin_ack_no_account_id", type: thin.type };
        }
      } else {
        await recordAuditEvent({
          action: "STRIPE_WEBHOOK_IGNORED",
          meta: { type: thin.type, eventId: thin.id, route, kind: "thin" },
        });
        handlerResult = { action: "ignored", type: thin.type };
      }
    }

    await markProcessed(eventId, eventType);
    return Response.json({ ok: true, eventId, eventType, result: handlerResult });
  } catch {
    console.error(`[stripe:webhook:${route}] handler error`, eventType);
    // Do not mark processed — Stripe should retry.
    return new Response("Handler error", { status: 500 });
  }
}
