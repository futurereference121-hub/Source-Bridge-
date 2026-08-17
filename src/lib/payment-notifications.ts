import {
  createNotification,
  createNotifications,
} from "@/lib/notifications";

function actorLabel(name: string, username: string | null | undefined): string {
  const u = (username || "").trim();
  if (u) return `@${u.replace(/^@/, "")}`;
  return (name || "").trim() || "Someone";
}

function inboxHref(conversationId: string): string {
  return `/inbox/${conversationId}`;
}

/** Counterparty notification when a Payment Ticket is proposed. */
export async function notifyPaymentTicketProposed(opts: {
  ticketId: string;
  conversationId: string;
  counterpartyId: string;
  actorId: string;
  actorName: string;
  actorUsername?: string | null;
  title: string;
}): Promise<void> {
  const who = actorLabel(opts.actorName, opts.actorUsername);
  await createNotification({
    userId: opts.counterpartyId,
    type: "PAYMENT_TICKET",
    title: `${who} proposed a Payment Ticket`,
    body: opts.title.slice(0, 140),
    href: inboxHref(opts.conversationId),
    actorId: opts.actorId,
    actorName: who,
    dedupeKey: `pt-proposed:${opts.ticketId}`,
  });
}

/** Notify the waiting party after accept / dual-accept. */
export async function notifyPaymentTicketAccepted(opts: {
  ticketId: string;
  conversationId: string;
  notifyUserId: string;
  actorId: string;
  actorName: string;
  actorUsername?: string | null;
  bothAccepted: boolean;
}): Promise<void> {
  const who = actorLabel(opts.actorName, opts.actorUsername);
  await createNotification({
    userId: opts.notifyUserId,
    type: "PAYMENT_TICKET",
    title: opts.bothAccepted
      ? `${who} accepted — ready to pay`
      : `${who} accepted the Payment Ticket`,
    body: opts.bothAccepted
      ? "Both parties agreed. The buyer can fund when ready."
      : "Waiting for your acceptance.",
    href: inboxHref(opts.conversationId),
    actorId: opts.actorId,
    actorName: who,
    dedupeKey: opts.bothAccepted
      ? `pt-both-accepted:${opts.ticketId}`
      : `pt-accepted:${opts.ticketId}:${opts.actorId}`,
  });
}

export async function notifyPaymentFunded(opts: {
  protectedTxnId: string;
  conversationId: string;
  sellerId: string;
  buyerId: string;
  title: string;
}): Promise<void> {
  await createNotification({
    userId: opts.sellerId,
    type: "PAYMENT_STATUS",
    title: "Payment received",
    body: opts.title.slice(0, 140),
    href: inboxHref(opts.conversationId),
    actorId: opts.buyerId,
    actorName: "Buyer",
    dedupeKey: `pt-funded:${opts.protectedTxnId}`,
  });
}

export async function notifyShipmentUpdate(opts: {
  protectedTxnId: string;
  conversationId: string;
  buyerId: string;
  sellerId: string;
  trackingNumber?: string;
}): Promise<void> {
  await createNotification({
    userId: opts.buyerId,
    type: "PAYMENT_SHIPPING",
    title: "Your order was marked shipped",
    body: opts.trackingNumber
      ? `Tracking: ${opts.trackingNumber.slice(0, 80)}`
      : "The sourcer added shipping details.",
    href: inboxHref(opts.conversationId),
    actorId: opts.sellerId,
    actorName: "Sourcer",
    dedupeKey: `pt-shipped:${opts.protectedTxnId}`,
  });
}

export async function notifyDisputeOpened(opts: {
  disputeId: string;
  protectedTxnId: string;
  conversationId: string;
  buyerId: string;
  sellerId: string;
  category: string;
  openedById: string;
}): Promise<void> {
  const summary = opts.category || "Payment issue reported";
  await createNotifications([
    {
      userId: opts.sellerId,
      type: "PAYMENT_DISPUTE",
      title: "Buyer reported a payment issue",
      body: summary.slice(0, 140),
      href: inboxHref(opts.conversationId),
      actorId: opts.openedById,
      actorName: "Buyer",
      dedupeKey: `dispute-open:${opts.disputeId}:seller`,
    },
  ]);
}

export async function notifyDisputeResolved(opts: {
  disputeId: string;
  conversationId: string;
  buyerId: string;
  sellerId: string;
  resolution: string;
}): Promise<void> {
  const body = "Admin reviewed your payment issue.";
  await createNotifications([
    {
      userId: opts.buyerId,
      type: "PAYMENT_DISPUTE",
      title: "Payment issue resolved",
      body,
      href: inboxHref(opts.conversationId),
      dedupeKey: `dispute-resolved:${opts.disputeId}:buyer`,
    },
    {
      userId: opts.sellerId,
      type: "PAYMENT_DISPUTE",
      title: "Payment issue resolved",
      body,
      href: inboxHref(opts.conversationId),
      dedupeKey: `dispute-resolved:${opts.disputeId}:seller`,
    },
  ]);
}
