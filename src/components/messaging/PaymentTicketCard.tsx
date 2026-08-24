"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Loader2, MoreHorizontal, ShieldCheck, X } from "lucide-react";
import { formatMinor } from "@/lib/payments/money";
import { listingProtectedShipmentPhotoRequired } from "@/lib/payments/fulfilment-rules";
import { ProtectedPaymentCheckout } from "@/components/payments/ProtectedPaymentCheckout";
import {
  ProposePaymentTicketButton,
} from "@/components/messaging/ProposePaymentTicketButton";
import { AddPhotoControl } from "@/components/media/AddPhotoControl";
import {
  deriveCompletedFinancialSubstatus,
  getPaymentTicketActions,
  isCompletedLifecycleTicket,
  isSubtleHistoricalTicket,
  isTerminalLifecycleStage,
  resolveAuthoritativeViewerId,
  resolveLifecycleStage,
  shouldShowFundsFrozenBanner,
  shouldShowItemFundsRemainingProtectedMessage,
  subtleHistoricalLabel,
  ticketAppearsInChatTimeline,
  ticketMayShowPayUi,
  waitingCopyAddressesViewer,
  isProductPurchaseOrigin,
} from "@/lib/payments/ticket-lifecycle";
import { shouldApplyTicketUpdate } from "@/lib/payments/ticket-state-guard";

const DEFAULT_BREAKDOWN_LABELS = {
  itemCost: "Item / procurement budget",
  shipping: "Shipping",
  sellerServiceFee: "Sourcer fee",
  sourceBridgeProtectionFee: "Source Bridge fee",
} as const;

const PAYMENT_ISSUE_CATEGORIES = [
  "Item not as agreed",
  "Wrong item received",
  "Damaged in transit",
  "Missing parts or accessories",
  "Not as described",
  "Other",
] as const;

function normalizeTicketView(raw: PaymentTicketView): PaymentTicketView {
  const labels = raw.breakdown?.labels ?? DEFAULT_BREAKDOWN_LABELS;
  const existing = raw.breakdown ?? {};
  return {
    ...raw,
    currency: (raw.currency || "GBP").toUpperCase(),
    breakdown: {
      ...existing,
      labels,
      releaseStructure: existing.releaseStructure ?? null,
    },
  };
}

function safeUsernameHandle(
  username: string | null | undefined,
): string | null {
  if (typeof username !== "string" || !username.trim()) return null;
  return `@${username.replace(/^@/, "")}`;
}

function resolveRoleHandle(opts: {
  party: { username?: string | null; name?: string | null } | null | undefined;
  roleUserId: string;
  myId: string;
  peer?: {
    id: string;
    username?: string | null;
    name?: string | null;
  } | null;
  youLabel: string;
  genericLabel: string;
}): string {
  const fromParty = opts.party?.username
    ? `@${opts.party.username.replace(/^@/, "")}`
    : opts.party?.name || null;
  if (fromParty) return fromParty;
  if (opts.roleUserId === opts.myId) return opts.youLabel;
  if (opts.peer && opts.roleUserId === opts.peer.id) {
    return opts.peer.username
      ? `@${opts.peer.username.replace(/^@/, "")}`
      : opts.peer.name || opts.genericLabel;
  }
  return opts.genericLabel;
}

export type PaymentTicketView = {
  id: string;
  conversationId: string;
  createdById?: string;
  viewer?: {
    id: string;
    username: string | null;
  } | null;
  status: string;
  revision: number;
  termsHash: string;
  title: string;
  currency: string;
  itemCostMinor: number;
  shippingMinor: number;
  sellerServiceFeeMinor: number;
  protectionFeeMinor: number;
  totalChargeMinor: number;
  paymentOption: string;
  origin?: string | null;
  procurementAdvanceAgreed: boolean;
  procurementAdvanceMinor: number;
  buyerId: string;
  sellerId: string;
  buyerApprovedRevision: number | null;
  sellerApprovedRevision: number | null;
  protectedTransactionId: string | null;
  protectedTxnStatus?: string | null;
  fundedAt?: string | null;
  paymentIntentStatus?: string | null;
  lifecycleStage?: string;
  lifecycleLabel?: string;
  createdAt?: string;
  notes?: string;
  proposedBy?: {
    id: string;
    name: string;
    username: string | null;
  } | null;
  buyerParty?: {
    id: string;
    name: string;
    username: string | null;
  } | null;
  sellerParty?: {
    id: string;
    name: string;
    username: string | null;
  } | null;
  sellerConnect?: {
    ready?: boolean;
    hasAccount?: boolean;
  } | null;
  acceptance?: {
    canAccept?: boolean;
    waitingForOther?: boolean;
    waitingLabel?: string | null;
  } | null;
  actions?: {
    canReleaseProcurement?: boolean;
    canPay?: boolean;
    canAccept?: boolean;
    canEdit?: boolean;
    canCancel?: boolean;
    canDelete?: boolean;
    canMarkShipped?: boolean;
    canAddTracking?: boolean;
    canConfirmReceipt?: boolean;
    canReleaseNow?: boolean;
    canReportIssue?: boolean;
  };
  trackingNumber?: string;
  trackingCarrier?: string;
  shipmentPhotoUrl?: string;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  inspectionEndsAt?: string | null;
  books?: {
    itemFundsReleasedEarlyMinor: number;
    remainingProtectedSellerShareMinor: number;
    platformFeeMinor: number;
    procurementTransferredMinor: number;
    finalTransferredMinor?: number;
    finalResidualMinor?: number;
    sellerEntitledMinor?: number;
    refundedMinor?: number;
  };
  breakdown: {
    labels: {
      itemCost: string;
      shipping: string;
      sellerServiceFee: string;
      sourceBridgeProtectionFee: string;
    };
    releaseStructure?: {
      itemFundsReleasedEarlyMinor: number;
      remainingProtectedSellerShareMinor: number;
      platformFeeHeldMinor: number;
      note: string;
    } | null;
  };
  /** Authoritative open dispute — frozen banner only when OPEN / UNDER_REVIEW. */
  openDisputeStatus?: string | null;
  openDisputeResolutionNote?: string | null;
  openDisputeResolvedAt?: string | null;
  platformFeeIncludedInPrice?: boolean;
};

type Props = {
  ticketId: string;
  myId: string;
  myUsername?: string | null;
  proposedAt?: string | null;
  proposedByName?: string | null;
  onChanged?: () => void;
  /** Lifted collapse state so conversation revalidation does not reset it. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Role-neutral conversation payload — Accept derives from this + myId. */
  ticketSnapshot?: PaymentTicketView | null;
  /** Merge this ticket only — do not remount the thread. */
  onTicketUpdated?: (ticket: PaymentTicketView) => void;
  /** Other chat participant — fallback when party snapshots are missing. */
  conversationPeer?: {
    id: string;
    username?: string | null;
    name?: string | null;
  } | null;
};

export function PaymentTicketCard({
  ticketId,
  myId,
  myUsername,
  proposedAt,
  proposedByName,
  onChanged,
  expanded: expandedControlled,
  onExpandedChange,
  ticketSnapshot = null,
  onTicketUpdated,
  conversationPeer = null,
}: Props) {
  const [ticket, setTicket] = useState<PaymentTicketView | null>(() => {
    if (ticketSnapshot && ticketSnapshot.id === ticketId) {
      const snap = normalizeTicketView({ ...ticketSnapshot });
      delete (snap as { viewer?: unknown }).viewer;
      return snap;
    }
    return null;
  });
  const [loading, setLoading] = useState(
    !(ticketSnapshot && ticketSnapshot.id === ticketId),
  );
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const actionLockRef = useRef(false);
  const [error, setError] = useState("");
  const [payNotice, setPayNotice] = useState("");
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [expandedLocal, setExpandedLocal] = useState(false);
  const expanded =
    typeof expandedControlled === "boolean"
      ? expandedControlled
      : expandedLocal;
  const setExpanded = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const value =
        typeof next === "function" ? next(expanded) : next;
      if (onExpandedChange) onExpandedChange(value);
      else setExpandedLocal(value);
    },
    [expanded, onExpandedChange],
  );
  const [gone, setGone] = useState(false);
  const autoExpandDone = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const [checkout, setCheckout] = useState<{
    clientSecret: string;
    publishableKey: string;
    amountMinor: number;
    currency: string;
  } | null>(null);
  const [payFailed, setPayFailed] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [paymentsAccess, setPaymentsAccess] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [trackingInput, setTrackingInput] = useState("");
  const [shipmentPhotoUrl, setShipmentPhotoUrl] = useState("");
  const [shipmentPhotoPreview, setShipmentPhotoPreview] = useState("");
  const [shippingPhotoRevealed, setShippingPhotoRevealed] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueCategory, setIssueCategory] = useState<string>(
    PAYMENT_ISSUE_CATEGORIES[0],
  );
  const [issueReason, setIssueReason] = useState("");
  const [issueDetails, setIssueDetails] = useState("");
  const [issueEvidenceUrls, setIssueEvidenceUrls] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const res = await fetch(`/api/payments/tickets/${ticketId}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Cache-Control": "no-store" },
      });
      const json = (await res.json()) as {
        ok?: boolean;
        ticket?: PaymentTicketView;
        error?: string;
      };
      if (res.status === 404) {
        setGone(true);
        setTicket(null);
        return;
      }
      if (!res.ok || !json.ticket) {
        if (!silent) {
          setError(json.error || "Could not load Payment Ticket");
          if (!ticketSnapshot || ticketSnapshot.id !== ticketId) {
            setTicket(null);
          }
        }
      } else {
        const next = normalizeTicketView(json.ticket as PaymentTicketView);
        // Role-neutral: never persist a previous viewer's identity on the ticket.
        delete (next as { viewer?: unknown }).viewer;
        setTicket((prev) => {
          if (prev && !shouldApplyTicketUpdate(next, prev)) return prev;
          return next;
        });
      }
    } catch {
      if (!silent) setError("Could not load Payment Ticket");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    autoExpandDone.current = false;
    setGone(false);
    setError("");
    setCheckout(null);
    setPaymentSubmitted(false);
    if (ticketSnapshot && ticketSnapshot.id === ticketId) {
      const snap = normalizeTicketView({ ...ticketSnapshot });
      delete (snap as { viewer?: unknown }).viewer;
      setTicket(snap);
      setLoading(false);
      // Conversation payload already has compact + lifecycle — skip per-ticket GET.
      return;
    }
    setTicket(null);
    void load();
  }, [load, ticketId, ticketSnapshot?.id]);

  useEffect(() => {
    if (!ticketSnapshot || ticketSnapshot.id !== ticketId) return;
    setTicket((prev) => {
      if (prev && prev.id !== ticketSnapshot.id) return prev;
      const snap = normalizeTicketView({ ...ticketSnapshot });
      delete (snap as { viewer?: unknown }).viewer;
      if (!prev) return snap;
      if (
        prev.status === snap.status &&
        prev.revision === snap.revision &&
        prev.buyerApprovedRevision === snap.buyerApprovedRevision &&
        prev.sellerApprovedRevision === snap.sellerApprovedRevision &&
        prev.protectedTxnStatus === snap.protectedTxnStatus &&
        prev.lifecycleStage === snap.lifecycleStage &&
        prev.totalChargeMinor === snap.totalChargeMinor &&
        prev.title === snap.title &&
        prev.shippedAt === snap.shippedAt &&
        prev.deliveredAt === snap.deliveredAt &&
        prev.trackingNumber === snap.trackingNumber &&
        prev.fundedAt === snap.fundedAt &&
        prev.paymentIntentStatus === snap.paymentIntentStatus &&
        prev.actions?.canPay === snap.actions?.canPay &&
        prev.actions?.canConfirmReceipt === snap.actions?.canConfirmReceipt &&
        prev.actions?.canReleaseNow === snap.actions?.canReleaseNow
      ) {
        return prev;
      }
      if (!shouldApplyTicketUpdate(snap, prev)) return prev;
      return { ...prev, ...snap, viewer: undefined };
    });
  }, [ticketSnapshot, ticketId]);

  useEffect(() => {
    if (!ticket || autoExpandDone.current || !myId) return;
    const viewerId = resolveAuthoritativeViewerId({
      conversationSessionUserId: myId,
      accountId: myId,
      ticketViewerId: ticket.viewer?.id,
      buyerId: ticket.buyerId,
      sellerId: ticket.sellerId,
    });
    const d = getPaymentTicketActions(
      {
        status: ticket.status,
        createdById: ticket.createdById,
        buyerId: ticket.buyerId,
        sellerId: ticket.sellerId,
        revision: ticket.revision,
        buyerApprovedRevision: ticket.buyerApprovedRevision,
        sellerApprovedRevision: ticket.sellerApprovedRevision,
        protectedTransactionId: ticket.protectedTransactionId,
      },
      viewerId,
    );
    if (d.viewerMayAccept) {
      autoExpandDone.current = true;
      setExpanded(true);
    }
  }, [ticket, myId, setExpanded]);

  useEffect(() => {
    void fetch("/api/payments/connect")
      .then((r) => r.json())
      .then(
        (j: {
          paymentsAccess?: { testAccessAllowed?: boolean };
          flags?: { PAYMENTS_ENABLED?: boolean };
        }) => {
          setPaymentsAccess(
            Boolean(
              j.flags?.PAYMENTS_ENABLED && j.paymentsAccess?.testAccessAllowed,
            ),
          );
        },
      )
      .catch(() => setPaymentsAccess(false));
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || menuPanelRef.current?.contains(t)) {
        return;
      }
      setMenuOpen(false);
    }
    // Use click (not mousedown) so menu item onClick always fires first.
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpen]);

  // Soft revalidate ticket state while conversation is open (visibility-aware).
  // Skip GET only when the parent poll supplies a snapshot AND we are not in
  // an in-flight checkout / post-submit funding wait.
  useEffect(() => {
    if (typeof window === "undefined" || !ticketId) return;
    if (
      ticketSnapshot &&
      ticketSnapshot.id === ticketId &&
      !checkout &&
      !paymentSubmitted
    ) {
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const POLL_MS = 2500;
    async function soft() {
      if (cancelled || inFlight) return;
      if (document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        await load({ silent: true });
      } finally {
        inFlight = false;
      }
    }
    const id = window.setInterval(() => void soft(), POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void soft();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener("online", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener("online", onVis);
    };
  }, [ticketId, load, ticketSnapshot?.id, checkout, paymentSubmitted]);

  // After return from 3DS: poll — client reconcile + webhook both mark FUNDED.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") !== "return") return;
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      void load({ silent: true });
      if (n >= 12) window.clearInterval(id);
    }, 2500);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!ticket) return;
    const showPay = ticketMayShowPayUi({
      ticketStatus: ticket.status,
      protectedStatus: ticket.protectedTxnStatus ?? null,
      fundedAt: ticket.fundedAt ?? null,
      paymentIntentStatus: ticket.paymentIntentStatus ?? null,
      lifecycleStage: ticket.lifecycleStage ?? null,
    });
    if (!showPay) {
      setCheckout(null);
      setPaymentSubmitted(false);
    }
  }, [ticket]);

  async function respond(action: "accept" | "decline") {
    if (actionLockRef.current || busy) return;
    actionLockRef.current = true;
    setBusy(true);
    setPendingAction(action);
    setError("");
    try {
      const res = await fetch(`/api/payments/tickets/${ticketId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(ticket?.revision != null
            ? { expectedRevision: ticket.revision }
            : {}),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        ticket?: PaymentTicketView;
        error?: string;
      };
      if (!res.ok || !json.ticket) {
        setError(json.error || "Action failed");
      } else {
        const next = normalizeTicketView(json.ticket);
        delete (next as { viewer?: unknown }).viewer;
        setTicket(next);
        onTicketUpdated?.(next);
        onChanged?.();
      }
    } catch {
      setError("Action failed");
    } finally {
      actionLockRef.current = false;
      setBusy(false);
      setPendingAction(null);
    }
  }

  async function cancelAgreement() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/payments/tickets/${ticketId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        ticket?: PaymentTicketView;
        error?: string;
      };
      if (!res.ok || !json.ticket) {
        setError(json.error || "Could not cancel agreement");
      } else {
        setTicket(json.ticket);
        setConfirmCancel(false);
        setMenuOpen(false);
        onChanged?.();
      }
    } catch {
      setError("Could not cancel agreement");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTicket() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/payments/tickets/${ticketId}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        deleted?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error || "Could not delete ticket");
      } else {
        setGone(true);
        setTicket(null);
        setConfirmDelete(false);
        setMenuOpen(false);
        onChanged?.();
      }
    } catch {
      setError("Could not delete ticket");
    } finally {
      setBusy(false);
    }
  }

  async function startConnectSetup() {
    setConnectBusy(true);
    setError("");
    try {
      const res = await fetch("/api/payments/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "onboard" }),
      });
      const json = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !json.url) {
        setError(json.error || "Could not start TEST payment setup");
        return;
      }
      window.location.href = json.url;
    } catch {
      setError("Could not start TEST payment setup");
    } finally {
      setConnectBusy(false);
    }
  }

  async function startPay() {
    if (!ticket?.protectedTransactionId) return;
    setBusy(true);
    setPayNotice("");
    setError("");
    setCheckout(null);
    try {
      const isDirect =
        ticket.paymentOption === "INSTANT" || ticket.paymentOption === "DIRECT";
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protectedTxnId: ticket.protectedTransactionId,
          idempotencyKey: `pay_${ticket.id}_${ticket.termsHash}_${isDirect ? "dest_v1" : "prot_v1"}`,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        clientSecret?: string;
        publishableKey?: string;
        amountMinor?: number;
        currency?: string;
      };
      if (!res.ok) {
        if (
          json.code === "ALREADY_FUNDED" ||
          json.code === "PI_ALREADY_SUCCEEDED" ||
          json.code === "PI_PROCESSING"
        ) {
          setCheckout(null);
          setPaymentSubmitted(true);
          setPayFailed(false);
          setPayNotice(
            json.code === "PI_PROCESSING"
              ? "Payment is processing. Funds stay on the platform until release rules. Do not pay again."
              : "Payment received. Funds stay on the platform until release rules. Do not pay again.",
          );
          await load();
          onChanged?.();
        } else if (json.code === "CONNECT_NOT_READY") {
          setError("");
          setPayFailed(false);
        } else {
          setError(json.error || "Checkout unavailable");
        }
      } else if (json.clientSecret && json.publishableKey) {
        setPayFailed(false);
        setCheckout({
          clientSecret: json.clientSecret,
          publishableKey: json.publishableKey,
          amountMinor: json.amountMinor ?? ticket.totalChargeMinor,
          currency: json.currency ?? ticket.currency,
        });
        setPayNotice(
          "Complete payment below. Status updates after Stripe confirms (do not pay again).",
        );
      } else {
        setError("Checkout did not return a payment form");
      }
    } catch {
      setError("Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  async function releaseItemFunds() {
    if (!ticket?.protectedTransactionId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/payments/release-procurement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protectedTxnId: ticket.protectedTransactionId,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        alreadyReleased?: boolean;
      };
      if (!res.ok) {
        setError(
          json.error ||
            "Could not release item funds. Payment remains on the platform.",
        );
      } else {
        setPayNotice(
          json.message ||
            "Item funds released. Shipping and remaining amount stay protected.",
        );
        setConfirmRelease(false);
        await load();
        onChanged?.();
      }
    } catch {
      setError(
        "Could not release item funds. Payment remains on the platform.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function markShipped() {
    if (!ticket?.protectedTransactionId) return;
    const trackingNumber = trackingInput.trim();
    if (trackingNumber.length < 4) {
      setError("Enter a valid tracking number");
      return;
    }
    const needsPhoto = listingProtectedShipmentPhotoRequired({
      origin: ticket.origin,
      paymentOption: ticket.paymentOption,
    });
    if (needsPhoto && !shipmentPhotoUrl) {
      setError("Upload a shipment photo before marking shipped");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/payments/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protectedTxnId: ticket.protectedTransactionId,
          transactionId: ticket.protectedTransactionId,
          carrier: carrier.trim() || undefined,
          trackingNumber,
          shipmentPhotoUrl: shipmentPhotoUrl || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        activityVersion?: number;
        ticket?: PaymentTicketView;
        transaction?: {
          status?: string;
          trackingNumber?: string | null;
          trackingCarrier?: string | null;
          shipmentPhotoUrl?: string | null;
          shippedAt?: string | null;
        };
      };
      if (!res.ok) {
        setError(json.error || "Could not mark as shipped");
      } else {
        setPayNotice("Marked as shipped. Remaining earnings stay protected.");
        setCarrier("");
        setTrackingInput("");
        setShipmentPhotoUrl("");
        setShipmentPhotoPreview("");
        // Apply canonical mutation response immediately (before remote poll).
        let nextLocal: PaymentTicketView | null = null;
        if (json.ticket) {
          const next = normalizeTicketView(json.ticket);
          delete (next as { viewer?: unknown }).viewer;
          setTicket((prev) => {
            if (prev && !shouldApplyTicketUpdate(next, prev)) return prev;
            nextLocal = next;
            return next;
          });
        } else if (json.transaction) {
          setTicket((prev) => {
            if (!prev) return prev;
            const nextStatus =
              json.transaction?.status || prev.protectedTxnStatus;
            nextLocal = {
              ...prev,
              trackingNumber:
                json.transaction?.trackingNumber || prev.trackingNumber,
              trackingCarrier:
                json.transaction?.trackingCarrier || prev.trackingCarrier,
              shipmentPhotoUrl:
                json.transaction?.shipmentPhotoUrl || prev.shipmentPhotoUrl,
              shippedAt: json.transaction?.shippedAt ?? prev.shippedAt,
              protectedTxnStatus: nextStatus,
              // Prefer server status for stage; do not force AWAITING_SHIPMENT.
              lifecycleStage:
                nextStatus === "IN_TRANSIT" ||
                nextStatus === "OUT_FOR_DELIVERY"
                  ? "IN_TRANSIT"
                  : nextStatus === "DELIVERED"
                    ? "DELIVERED"
                    : prev.lifecycleStage === "FUNDED" ||
                        prev.lifecycleStage === "AWAITING_SHIPMENT"
                      ? "AWAITING_SHIPMENT"
                      : prev.lifecycleStage,
              actions: {
                ...prev.actions,
                canMarkShipped: false,
                canAddTracking: false,
              },
            };
            return nextLocal;
          });
        }
        if (nextLocal) {
          onTicketUpdated?.(nextLocal);
        }
        onChanged?.();
        void load({ silent: true });
      }
    } catch {
      setError("Could not mark as shipped");
    } finally {
      setBusy(false);
    }
  }

  async function submitReceiptDecision(
    decision: "ACKNOWLEDGE" | "RELEASE_NOW" | "START_INSPECTION" | "REPORT_ISSUE",
  ) {
    if (!ticket?.protectedTransactionId) return;
    if (actionLockRef.current || busy) return;
    const issueSummary =
      issueCategory === "Other"
        ? issueReason.trim()
        : issueCategory;
    if (
      decision === "REPORT_ISSUE" &&
      (issueCategory === "Other"
        ? issueReason.trim().length < 3
        : !issueCategory.trim())
    ) {
      setError(
        issueCategory === "Other"
          ? "Describe the issue (min 3 characters)"
          : "Select an issue category",
      );
      return;
    }
    actionLockRef.current = true;
    setBusy(true);
    setPendingAction(decision);
    setError("");
    try {
      const evidenceNote = issueEvidenceUrls.length
        ? `Evidence: ${issueEvidenceUrls.join(" ")}`
        : "";
      const detailsJoined = [issueDetails.trim(), evidenceNote]
        .filter(Boolean)
        .join("\n\n");
      const res = await fetch("/api/payments/confirm-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protectedTxnId: ticket.protectedTransactionId,
          decision,
          category:
            decision === "REPORT_ISSUE" ? issueCategory : undefined,
          reason:
            decision === "REPORT_ISSUE" ? issueSummary : undefined,
          details:
            decision === "REPORT_ISSUE" ? detailsJoined || undefined : undefined,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        alreadyConfirmed?: boolean;
        transferTriggered?: boolean;
        decision?: string;
        transaction?: {
          status?: string;
          inspectionEndsAt?: string | null;
          deliveredAt?: string | null;
        };
      };
      if (!res.ok) {
        setError(json.error || "Could not complete decision");
      } else {
        if (decision === "RELEASE_NOW") {
          setPayNotice(
            json.alreadyConfirmed || !json.transferTriggered
              ? "Funds release already processed (or zero residual)."
              : "Residual seller funds released to the sourcer.",
          );
        } else if (decision === "START_INSPECTION") {
          setPayNotice(
            json.alreadyConfirmed
              ? "Inspection period already active — no funds released."
              : "Inspection started — remaining seller funds stay protected. You can still release early.",
          );
        } else if (decision === "ACKNOWLEDGE") {
          setPayNotice(
            json.alreadyConfirmed
              ? "Item already marked received."
              : "Item received. Choose release funds now or start a 12-hour inspection.",
          );
        } else {
          setPayNotice(
            json.alreadyConfirmed
              ? "Issue already open — auto-release remains frozen."
              : "Issue reported — remaining funds held; auto-release frozen.",
          );
        }
        setIssueOpen(false);
        setIssueCategory(PAYMENT_ISSUE_CATEGORIES[0]);
        setIssueReason("");
        setIssueDetails("");
        setIssueEvidenceUrls([]);
        let nextLocal: PaymentTicketView | null = null;
        setTicket((prev) => {
          if (!prev) return prev;
          nextLocal = {
            ...prev,
            inspectionEndsAt:
              json.transaction?.inspectionEndsAt ?? prev.inspectionEndsAt,
            deliveredAt:
              json.transaction?.deliveredAt ?? prev.deliveredAt,
            protectedTxnStatus:
              decision === "START_INSPECTION"
                ? "IN_INSPECTION"
                : decision === "REPORT_ISSUE"
                  ? "DISPUTED"
                  : json.transaction?.status || prev.protectedTxnStatus,
            lifecycleStage:
              decision === "START_INSPECTION"
                ? "IN_INSPECTION"
                : decision === "RELEASE_NOW"
                  ? "READY_TO_RELEASE"
                  : decision === "REPORT_ISSUE"
                    ? "DISPUTED"
                    : prev.lifecycleStage,
            actions: {
              ...prev.actions,
              ...(decision === "START_INSPECTION"
                ? { canReleaseNow: true, canReportIssue: true }
                : {}),
              ...(decision === "REPORT_ISSUE"
                ? { canReleaseNow: false, canReportIssue: false }
                : {}),
            },
            openDisputeStatus:
              decision === "REPORT_ISSUE"
                ? "UNDER_REVIEW"
                : prev.openDisputeStatus,
          };
          return nextLocal;
        });
        if (nextLocal) {
          onTicketUpdated?.(nextLocal);
        }
        onChanged?.();
        void load({ silent: true });
      }
    } catch {
      setError("Could not complete decision");
    } finally {
      actionLockRef.current = false;
      setBusy(false);
      setPendingAction(null);
    }
  }

  if (gone) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/50">
        <Loader2 size={16} className="animate-spin" /> Loading Payment Ticket…
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/50">
        {error || "Payment Ticket unavailable"}
      </div>
    );
  }

  if (
    !ticketAppearsInChatTimeline({
      ticketStatus: ticket.status,
      protectedStatus: ticket.protectedTxnStatus ?? null,
      origin: ticket.origin ?? null,
    })
  ) {
    return null;
  }

  const sessionViewerId = resolveAuthoritativeViewerId({
    conversationSessionUserId: myId,
    accountId: myId,
    ticketViewerId: ticket.viewer?.id,
    buyerId: ticket.buyerId,
    sellerId: ticket.sellerId,
  });
  const sessionViewerUsername = myUsername || null;
  const iAmBuyer = sessionViewerId === ticket.buyerId;
  const iAmSeller = sessionViewerId === ticket.sellerId;
  const createdById =
    ticket.createdById || ticket.proposedBy?.id || "";
  const partyHandle = (party: {
    username?: string | null;
    name?: string | null;
  } | null | undefined) =>
    safeUsernameHandle(party?.username) || party?.name || null;
  const peer =
    conversationPeer ??
    (iAmBuyer
      ? {
          id: ticket.sellerId,
          username: ticket.sellerParty?.username ?? null,
          name: ticket.sellerParty?.name ?? null,
        }
      : {
          id: ticket.buyerId,
          username: ticket.buyerParty?.username ?? null,
          name: ticket.buyerParty?.name ?? null,
        });
  const buyerHandle = resolveRoleHandle({
    party: ticket.buyerParty,
    roleUserId: ticket.buyerId,
    myId: sessionViewerId,
    peer,
    youLabel: "You",
    genericLabel: "Buyer",
  });
  const sourcerHandle = resolveRoleHandle({
    party: ticket.sellerParty,
    roleUserId: ticket.sellerId,
    myId: sessionViewerId,
    peer,
    youLabel: "You",
    genericLabel: "Sourcer",
  });
  const proposerHandle =
    partyHandle(ticket.proposedBy) ||
    (createdById === ticket.buyerId
      ? buyerHandle
      : createdById === ticket.sellerId
        ? sourcerHandle
        : proposedByName) ||
    null;
  const ticketActions = getPaymentTicketActions(
    {
      status: ticket.status,
      createdById,
      buyerId: ticket.buyerId,
      sellerId: ticket.sellerId,
      revision: ticket.revision,
      buyerApprovedRevision: ticket.buyerApprovedRevision,
      sellerApprovedRevision: ticket.sellerApprovedRevision,
      protectedTransactionId: ticket.protectedTransactionId,
      buyerUsername: ticket.buyerParty?.username,
      sellerUsername: ticket.sellerParty?.username,
      viewerUsername: sessionViewerUsername,
    },
    sessionViewerId,
  );
  const acceptance = { ...ticketActions.acceptance };
  const waitingIsSelf = waitingCopyAddressesViewer({
    waitingLabel: acceptance.waitingLabel,
    viewerUsername: sessionViewerUsername,
    viewerId: sessionViewerId,
    waitForId: acceptance.counterpartyId,
  });
  if (waitingIsSelf) {
    acceptance.waitingForOther = false;
    acceptance.waitingLabel = null;
    if (!acceptance.myAcceptedCurrentRevision) {
      acceptance.canAccept = true;
      acceptance.canDecline = true;
      acceptance.viewerMayAccept = true;
      acceptance.shouldShowAcceptCTA = true;
    }
  }
  const subtleHistorical = isSubtleHistoricalTicket(ticket.status);
  const lifecycleStageResolved =
    ticket.lifecycleStage ||
    resolveLifecycleStage(
      ticket.status,
      ticket.protectedTxnStatus ?? null,
      (ticket.books?.procurementTransferredMinor ?? 0) > 0,
      ticket.deliveredAt ?? null,
    );
  const isCompleted = isCompletedLifecycleTicket({
    ticketStatus: ticket.status,
    protectedStatus: ticket.protectedTxnStatus ?? null,
    lifecycleStage: lifecycleStageResolved,
  });
  const completedSubstatus = isCompleted
    ? deriveCompletedFinancialSubstatus({
        protectedStatus: ticket.protectedTxnStatus ?? null,
        openDisputeStatus: ticket.openDisputeStatus ?? null,
        refundedMinor: ticket.books?.refundedMinor ?? 0,
        releasedToSellerMinor:
          (ticket.books?.procurementTransferredMinor ?? 0) +
          (ticket.books?.finalTransferredMinor ?? 0),
        platformFeeRefundedMinor: 0,
        platformFeeMinor:
          ticket.books?.platformFeeMinor ?? ticket.protectionFeeMinor ?? 0,
      })
    : null;
  const isTerminal =
    isTerminalLifecycleStage(lifecycleStageResolved) || subtleHistorical;
  // Actions / CTAs blocked for all terminal lifecycle stages.
  const historical = isTerminal;
  const open = !historical && (ticket.status === "PROPOSED" || ticket.status === "ACCEPTED");
  const viewerMayAccept = Boolean(sessionViewerId) && acceptance.viewerMayAccept;
  const isProductPurchase = isProductPurchaseOrigin(ticket.origin);
  const canRespond = Boolean(
    open && viewerMayAccept && acceptance.isParty && !isProductPurchase,
  );
  const sellerConnectReady = Boolean(ticket.sellerConnect?.ready);
  const sellerHandle =
    safeUsernameHandle(ticket.sellerParty?.username) || "the Sourcer";
  const canPay =
    !historical &&
    paymentsAccess &&
    iAmBuyer &&
    sellerConnectReady &&
    Boolean(ticket.protectedTransactionId) &&
    ticketMayShowPayUi({
      ticketStatus: ticket.status,
      protectedStatus: ticket.protectedTxnStatus ?? null,
      fundedAt: ticket.fundedAt ?? null,
      paymentIntentStatus: ticket.paymentIntentStatus ?? null,
      lifecycleStage: ticket.lifecycleStage ?? null,
    }) &&
    ticket.actions?.canPay !== false &&
    !paymentSubmitted;
  const showPaymentProcessing =
    !historical &&
    iAmBuyer &&
    Boolean(ticket.protectedTransactionId) &&
    !ticket.fundedAt &&
    ticket.status !== "FUNDED" &&
    (paymentSubmitted ||
      ticket.paymentIntentStatus === "processing" ||
      ticket.paymentIntentStatus === "succeeded");
  const needsSellerConnectSetup =
    !historical &&
    Boolean(ticket.protectedTransactionId) &&
    !sellerConnectReady &&
    (ticket.status === "ACCEPTED" ||
      ticket.status === "FUNDED" ||
      ticket.lifecycleStage === "AGREED_AWAITING_PAYMENT" ||
      ticket.lifecycleStage === "FUNDED");
  const buyerWaitingOnSellerConnect =
    needsSellerConnectSetup &&
    iAmBuyer &&
    (ticket.status === "ACCEPTED" ||
      ticket.lifecycleStage === "AGREED_AWAITING_PAYMENT");
  const sellerMustOnboard =
    needsSellerConnectSetup && iAmSeller;
  const isDirect =
    ticket.paymentOption === "INSTANT" || ticket.paymentOption === "DIRECT";
  const procAgreed =
    ticket.procurementAdvanceAgreed && ticket.procurementAdvanceMinor > 0;
  const procTransferred = (ticket.books?.procurementTransferredMinor ?? 0) > 0;
  const canRelease =
    !historical &&
    paymentsAccess &&
    iAmBuyer &&
    Boolean(ticket.actions?.canReleaseProcurement) &&
    Boolean(ticket.protectedTransactionId);
  const canMarkShipped =
    !historical &&
    paymentsAccess &&
    iAmSeller &&
    Boolean(ticket.actions?.canMarkShipped || ticket.actions?.canAddTracking) &&
    Boolean(ticket.protectedTransactionId);
  const canConfirmReceipt =
    !historical &&
    paymentsAccess &&
    iAmBuyer &&
    Boolean(ticket.actions?.canConfirmReceipt) &&
    Boolean(ticket.protectedTransactionId);
  const canReleaseNow =
    !historical &&
    paymentsAccess &&
    iAmBuyer &&
    Boolean(ticket.actions?.canReleaseNow) &&
    Boolean(ticket.protectedTransactionId);
  const canReportIssue =
    !historical &&
    paymentsAccess &&
    iAmBuyer &&
    Boolean(ticket.actions?.canReportIssue) &&
    Boolean(ticket.protectedTransactionId);
  const inInspection =
    ticket.protectedTxnStatus === "IN_INSPECTION" ||
    ticket.lifecycleStage === "IN_INSPECTION";
  const issueHold = shouldShowFundsFrozenBanner({
    ticketStatus: ticket.status,
    protectedStatus: ticket.protectedTxnStatus,
    lifecycleStage: lifecycleStageResolved,
    openDisputeStatus: ticket.openDisputeStatus,
  });
  const disputeResolved =
    Boolean(ticket.openDisputeStatus) &&
    ["RESOLVED_BUYER", "RESOLVED_SELLER", "RESOLVED_SPLIT", "CLOSED"].includes(
      ticket.openDisputeStatus || "",
    );
  const refundedMinor = ticket.books?.refundedMinor ?? 0;
  const releasedMinor =
    (ticket.books?.procurementTransferredMinor ?? 0) +
    (ticket.books?.finalTransferredMinor ?? 0);
  const hasTracking = Boolean(ticket.trackingNumber);
  const showFulfilment =
    !historical &&
    !isDirect &&
    Boolean(ticket.protectedTransactionId) &&
    (procTransferred ||
      hasTracking ||
      canMarkShipped ||
      canConfirmReceipt ||
      canReleaseNow ||
      canReportIssue ||
      issueHold ||
      [
        "FUNDED",
        "PROCUREMENT_RELEASED",
        "AWAITING_SHIPMENT",
        "IN_TRANSIT",
        "DELIVERED",
        "IN_INSPECTION",
        "READY_TO_RELEASE",
        "DISPUTED",
      ].includes(ticket.protectedTxnStatus || ticket.status));
  const residualProtected =
    ticket.books?.finalResidualMinor ??
    ticket.books?.remainingProtectedSellerShareMinor ??
    ticket.breakdown.releaseStructure?.remainingProtectedSellerShareMinor ??
    0;
  const remainingSellerFundsProtected =
    ticket.books?.remainingProtectedSellerShareMinor ??
    ticket.breakdown.releaseStructure?.remainingProtectedSellerShareMinor ??
    residualProtected;
  const platformFeeHeld =
    ticket.books?.platformFeeMinor ?? ticket.protectionFeeMinor ?? 0;
  const itemFundsReceived =
    ticket.books?.procurementTransferredMinor ?? 0;
  const sellerEntitledMinor =
    ticket.books?.sellerEntitledMinor ??
    ticket.itemCostMinor +
      ticket.shippingMinor +
      ticket.sellerServiceFeeMinor;
  const finalTransferredMinor =
    ticket.books?.finalTransferredMinor ?? 0;
  const remainingSellerEntitlement = Math.max(
    0,
    sellerEntitledMinor - itemFundsReceived - finalTransferredMinor,
  );
  const showItemFundsRemainingProtected =
    shouldShowItemFundsRemainingProtectedMessage({
      procurementTransferredMinor: itemFundsReceived,
      finalTransferredMinor,
      sellerEntitledMinor,
      protectedStatus: ticket.protectedTxnStatus ?? null,
      lifecycleStage: lifecycleStageResolved,
      ticketStatus: ticket.status,
    });
  const canEdit = Boolean(ticket.actions?.canEdit);
  const canCancel = Boolean(ticket.actions?.canCancel);
  const canDelete = Boolean(ticket.actions?.canDelete);
  const showMenu = canEdit || canCancel || canDelete;
  const stageLabel =
    ticket.lifecycleLabel ||
    ticket.lifecycleStage ||
    ticket.status;
  const proposerLabel =
    proposerHandle ||
    proposedByName ||
    (ticket.proposedBy?.username
      ? `@${ticket.proposedBy.username}`
      : ticket.proposedBy?.name) ||
    null;
  const proposedWhen = proposedAt || ticket.createdAt || null;

  function formatProposedTime(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const cur = (ticket.currency || "GBP").toUpperCase();
  const rows = [
    [ticket.breakdown.labels.itemCost, ticket.itemCostMinor],
    [ticket.breakdown.labels.shipping, ticket.shippingMinor],
    [ticket.breakdown.labels.sellerServiceFee, ticket.sellerServiceFeeMinor],
    [
      ticket.breakdown.labels.sourceBridgeProtectionFee,
      ticket.protectionFeeMinor,
    ],
  ] as const;

  const needsAction =
    canRespond ||
    canPay ||
    canRelease ||
    canMarkShipped ||
    canConfirmReceipt ||
    canReleaseNow ||
    canReportIssue ||
    Boolean(checkout) ||
    confirmRelease ||
    confirmCancel ||
    confirmDelete ||
    editOpen;

  // Collapse is allowed, but Accept/Pay CTAs stay visible in the collapsed chrome.
  const showExpanded = expanded;

  const acceptDeclineButtons = canRespond ? (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          void respond("accept");
        }}
        className="min-h-11 rounded-lg bg-electric px-4 py-2 text-sm font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
        data-testid="ticket-accept-agreement"
      >
        {pendingAction === "accept" ? "Accepting…" : "Accept Agreement"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          void respond("decline");
        }}
        className="min-h-11 rounded-lg border border-white/20 px-4 py-2 text-sm text-white/70 hover:border-white/40 disabled:opacity-50"
      >
        Decline
      </button>
    </>
  ) : null;

  const connectSetupBlock =
    sellerMustOnboard || buyerWaitingOnSellerConnect ? (
    <div className="relative z-20 mt-2 space-y-2">
      {sellerMustOnboard ? (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200/80">
            Payment setup required
          </p>
          <p className="text-xs text-white/65">
            To receive TEST payments, complete your Source Bridge TEST payout
            setup.
          </p>
          <button
            type="button"
            disabled={connectBusy}
            onClick={(e) => {
              e.stopPropagation();
              void startConnectSetup();
            }}
            className="min-h-11 w-full rounded-lg bg-electric px-4 py-2 text-sm font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
          >
            {connectBusy ? "Opening setup…" : "Complete Test Payment Setup"}
          </button>
        </>
      ) : (
        <p className="text-xs text-white/55">
          Waiting for {sellerHandle} to complete TEST payment setup before this
          agreement can be funded.
        </p>
      )}
    </div>
  ) : null;

  // --- Collapsed: subtle system-message style for cancelled/declined/superseded ---
  if (subtleHistorical && !showExpanded) {
    return (
      <div className="w-full min-w-0 max-w-full px-1 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full min-w-0 items-center justify-between gap-2 text-left text-[11px] text-white/40 hover:text-white/55"
        >
          <span className="min-w-0 truncate">
            {subtleHistoricalLabel(ticket.status)}
            {ticket.title ? ` · ${ticket.title}` : ""}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-white/30">
            View
          </span>
        </button>
      </div>
    );
  }

  // --- Collapsed: compact active / completed (no big CTAs) ---
  if (!showExpanded) {
    return (
      <div
        className={
          isCompleted
            ? "w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 opacity-85 sm:px-4"
            : "w-full min-w-0 max-w-full overflow-visible rounded-xl border border-electric/30 bg-[#07152c] px-3 py-2.5 sm:px-4"
        }
      >
        <div className="flex w-full min-w-0 items-start gap-1">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex min-w-0 flex-1 items-start justify-between gap-2 text-left sm:gap-3"
          data-sb-ticket-header="collapsed"
        >
          <div className="flex min-w-0 items-start gap-2">
            <ShieldCheck
              size={16}
              className={
                isCompleted
                  ? "mt-0.5 shrink-0 text-white/35"
                  : "mt-0.5 shrink-0 text-electric"
              }
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={
                    isCompleted
                      ? "rounded border border-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/45"
                      : "rounded border border-electric/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-electric"
                  }
                >
                  {isCompleted
                    ? `COMPLETED · ${completedSubstatus || "Funds Settled"}`
                    : stageLabel}
                </span>
                {(ticket.openDisputeStatus === "UNDER_REVIEW" ||
                  ticket.openDisputeStatus === "OPEN") &&
                !isCompleted ? (
                  <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-200/90">
                    UNDER REVIEW BY SOURCE BRIDGE
                  </span>
                ) : null}
                {needsAction || canRespond ? (
                  <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-200/90">
                    {canRespond
                      ? "Action required · Review Agreement"
                      : "Action required"}
                  </span>
                ) : null}
                <span className="rounded border border-amber-400/25 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-200/70">
                  {isProductPurchase ? "Product Purchase Ticket" : "TEST"}
                </span>
              </div>
              <p className="mt-1 truncate text-sm font-medium text-white/85">
                {ticket.title || "Payment Ticket"}
              </p>
              <p className="mt-0.5 text-xs tabular-nums text-white/50">
                {formatMinor(ticket.totalChargeMinor, cur)}
                <span className="text-white/30"> · v{ticket.revision}</span>
              </p>
              {acceptance.waitingForOther ? (
                <p className="mt-1 text-[11px] text-white/45">
                  {acceptance.waitingLabel}
                </p>
              ) : null}
            </div>
          </div>
          <ChevronDown
            size={16}
            className="mt-1 shrink-0 text-white/35"
            aria-hidden
          />
        </button>
        {showMenu ? (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className="mt-0.5 rounded-md border border-white/15 p-1 text-white/60 hover:border-white/30 hover:text-white"
              aria-label="Ticket actions"
              data-testid="ticket-actions-menu-collapsed"
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
        ) : null}
        </div>
        {canRespond ? (
          <div
            data-testid="ticket-action-required-collapsed"
            className="relative z-20 mt-2 overflow-visible"
          >
            <div className="flex w-full min-w-0 flex-wrap gap-2">
              {acceptDeclineButtons}
            </div>
          </div>
        ) : null}
        {connectSetupBlock}
        {canPay && !checkout ? (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              void startPay();
            }}
            className="relative z-20 mt-2 min-h-11 w-full rounded-lg bg-electric px-4 py-2 text-sm font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
          >
            {payFailed ? "Try Payment Again" : "Make Payment"}
          </button>
        ) : null}
        {showPaymentProcessing && !checkout ? (
          <div
            data-testid="ticket-payment-processing"
            className="relative z-20 mt-2 flex min-h-11 w-full items-center justify-center rounded-lg border border-electric/40 bg-electric/10 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-electric"
          >
            Payment processing
          </div>
        ) : null}
        {menuOpen && mounted && showMenu
          ? createPortal(
              <div
                className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:items-start md:justify-end md:bg-transparent md:p-0"
                onClick={() => setMenuOpen(false)}
              >
                <div
                  ref={menuPanelRef}
                  role="menu"
                  className="w-full max-w-xs overflow-hidden rounded-xl border border-white/15 bg-[#061228] py-1 shadow-xl md:absolute md:right-4 md:top-24 md:w-44"
                  onClick={(e) => e.stopPropagation()}
                >
                  {canEdit ? (
                    <button
                      type="button"
                      className="block w-full px-3 py-2.5 text-left text-xs text-white/80 hover:bg-white/5"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen(false);
                        setExpanded(true);
                        setEditOpen(true);
                      }}
                    >
                      Edit Terms
                    </button>
                  ) : null}
                  {canCancel ? (
                    <button
                      type="button"
                      className="block w-full px-3 py-2.5 text-left text-xs text-amber-200/90 hover:bg-white/5"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen(false);
                        setExpanded(true);
                        setConfirmCancel(true);
                      }}
                    >
                      Cancel Agreement
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      type="button"
                      className="block w-full px-3 py-2.5 text-left text-xs text-red-300/90 hover:bg-white/5"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen(false);
                        setExpanded(true);
                        setConfirmDelete(true);
                      }}
                    >
                      Delete Ticket
                    </button>
                  ) : null}
                </div>
              </div>,
              document.body,
            )
          : null}
      </div>
    );
  }

  return (
    <div
      className={
        historical
          ? "w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-4 opacity-80 sm:px-4"
          : "w-full min-w-0 max-w-full overflow-visible rounded-xl border border-electric/35 bg-[#07152c] px-3 py-4 sm:px-4"
      }
    >
      <div
        data-sb-ticket-header="expanded"
        className="flex min-w-0 flex-col gap-2"
      >
        <div className="flex min-w-0 items-start gap-2">
          <ShieldCheck
            size={18}
            className={
              historical
                ? "mt-0.5 shrink-0 text-white/40"
                : "mt-0.5 shrink-0 text-electric"
            }
          />
          <div className="min-w-0 flex-1">
            <p
              className={
                historical
                  ? "text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40"
                  : "text-[10px] font-semibold uppercase tracking-[0.16em] text-electric"
              }
            >
              Protected Payment
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-white">
              {ticket.title || "Payment Ticket"} · v{ticket.revision}
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-amber-200/70">
              TEST PAYMENT · Sandbox — no real money
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="shrink-0 rounded-md border border-white/15 p-1 text-white/55 hover:border-white/30 hover:text-white"
            aria-label="Collapse ticket"
          >
            <ChevronUp size={16} />
          </button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="rounded-md border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/55">
            {stageLabel}
          </span>
          {showMenu ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                disabled={busy}
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded-md border border-white/15 p-1 text-white/60 hover:border-white/30 hover:text-white"
                aria-label="Ticket actions"
              >
                <MoreHorizontal size={16} />
              </button>
              {menuOpen && mounted
                ? createPortal(
                    <div
                      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:items-start md:justify-end md:bg-transparent md:p-0"
                      onClick={() => setMenuOpen(false)}
                    >
                      <div
                        ref={menuPanelRef}
                        role="menu"
                        className="w-full max-w-xs overflow-hidden rounded-xl border border-white/15 bg-[#061228] py-1 shadow-xl md:absolute md:right-4 md:top-24 md:w-44"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canEdit ? (
                          <button
                            type="button"
                            className="block w-full px-3 py-2.5 text-left text-xs text-white/80 hover:bg-white/5"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setMenuOpen(false);
                              setEditOpen(true);
                            }}
                          >
                            Edit Terms
                          </button>
                        ) : null}
                        {canCancel ? (
                          <button
                            type="button"
                            className="block w-full px-3 py-2.5 text-left text-xs text-amber-200/90 hover:bg-white/5"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setMenuOpen(false);
                              setConfirmCancel(true);
                            }}
                          >
                            Cancel Agreement
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            className="block w-full px-3 py-2.5 text-left text-xs text-red-300/90 hover:bg-white/5"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setMenuOpen(false);
                              setConfirmDelete(true);
                            }}
                          >
                            Delete Ticket
                          </button>
                        ) : null}
                      </div>
                    </div>,
                    document.body,
                  )
                : null}
            </div>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="mt-1 text-[10px] text-white/40 hover:text-white/60"
      >
        Collapse
      </button>

      {canRespond ? (
        <div
          data-testid="ticket-action-required"
          className="mt-3 overflow-visible rounded-lg border border-amber-400/50 bg-amber-400/15 px-3 py-3"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">
            Action required
          </p>
          <p className="mt-1 text-sm font-medium text-white">
            {acceptance.viewerRoleLabel === "buyer"
              ? "You are the Buyer"
              : acceptance.viewerRoleLabel === "sourcer"
                ? "You are the Sourcer"
                : "Review agreement"}
          </p>
          <p className="mt-1 text-xs text-white/70">
            {proposerHandle
              ? `${proposerHandle} proposed this payment agreement.`
              : "Review the agreement before accepting."}
          </p>
          <div className="mt-2 flex w-full min-w-0 flex-wrap gap-2">
            {acceptDeclineButtons}
          </div>
        </div>
      ) : null}

      {acceptance.waitingForOther ? (
        <p className="mt-3 text-xs text-white/55">{acceptance.waitingLabel}</p>
      ) : null}

      {connectSetupBlock}

      {canPay && !checkout ? (
        <div
          data-testid="ticket-make-payment"
          className="mt-3 overflow-visible rounded-lg border border-electric/40 bg-electric/10 px-3 py-3"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-electric">
            You are the Buyer
          </p>
          <p className="mt-1 text-xs text-white/70">
            {acceptance.bothAcceptedLabel
              ? `${acceptance.bothAcceptedLabel}.`
              : "Ready for Protected Payment."}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void startPay()}
            className="mt-2 min-h-11 rounded-lg bg-electric px-4 py-2 text-sm font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
          >
            {payFailed ? "Try Payment Again" : "Make Payment"}
          </button>
        </div>
      ) : null}
      {showPaymentProcessing && !checkout ? (
        <div
          data-testid="ticket-payment-processing"
          className="mt-3 flex min-h-11 items-center justify-center rounded-lg border border-electric/40 bg-electric/10 px-3 py-3 text-sm font-semibold uppercase tracking-wide text-electric"
        >
          Payment processing
        </div>
      ) : null}

      {proposerLabel || proposedWhen ? (
        <p className="mt-2 text-xs text-white/45">
          Proposed by {proposerLabel || "member"}
          {proposedWhen ? ` · ${formatProposedTime(proposedWhen)}` : ""}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
            Buyer
          </p>
          <p className="mt-0.5 truncate font-medium text-white">{buyerHandle}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
            Sourcer
          </p>
          <p className="mt-0.5 truncate font-medium text-white">{sourcerHandle}</p>
        </div>
      </div>

      {acceptance.needsRoleRevision ? (
        <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">
            Roles need revision
          </p>
          <p className="mt-1 text-xs text-white/70">
            This agreement is missing a valid Buyer/Sourcer assignment. Do not
            accept or pay — propose a new revision with explicit roles.
          </p>
        </div>
      ) : null}

      <p className="mt-2 text-xs text-white/45">
        Protected by Source Bridge ·{" "}
        {isDirect ? "Direct Payment" : "Protected"} Transaction
        {historical
          ? " · no longer actionable"
          : isDirect
            ? " · funds route on fund"
            : procTransferred
              ? " · item funds released; remainder held until delivery"
              : " · funds held until release / delivery"}
      </p>

      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
        Review agreement
      </p>

      <dl className="mt-2 space-y-1.5 text-sm">
        {rows.map(([label, amount]) =>
          amount > 0 ||
          label.toLowerCase().includes("protection") ||
          label.toLowerCase().includes("source bridge") ? (
            <div key={label} className="flex justify-between gap-3 text-white/75">
              <dt>{label}</dt>
              <dd className="tabular-nums text-white">{formatMinor(amount, cur)}</dd>
            </div>
          ) : null,
        )}
        <div className="flex justify-between gap-3 border-t border-white/10 pt-2 font-medium text-white">
          <dt>Total</dt>
          <dd className="tabular-nums">
            {formatMinor(ticket.totalChargeMinor, cur)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 space-y-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/55">
        <p className="font-medium text-white/70">Dual-accept status · v{ticket.revision}</p>
        <p>
          Buyer:{" "}
          {acceptance.buyerAcceptedCurrentRevision
            ? "accepted this revision"
            : "not yet accepted"}
        </p>
        <p>
          Sourcer:{" "}
          {acceptance.sellerAcceptedCurrentRevision
            ? "accepted this revision"
            : "not yet accepted"}
        </p>
        {acceptance.bothAcceptedCurrentRevision && acceptance.bothAcceptedLabel ? (
          <p className="text-emerald-300/90">
            {acceptance.bothAcceptedLabel}
          </p>
        ) : null}
        {canRespond ? (
          <p className="text-amber-200/90">
            You need to review and accept this agreement.
          </p>
        ) : null}
        {procAgreed ? (
          <p>
            Procurement advance:{" "}
            {formatMinor(ticket.procurementAdvanceMinor, cur)} (buyer
            authorizes after funding)
          </p>
        ) : (
          <p>Procurement advance: not requested</p>
        )}
      </div>

      {procAgreed && ticket.breakdown.releaseStructure && !procTransferred ? (
        <div className="mt-3 space-y-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/55">
          <p className="font-medium text-white/70">Release structure</p>
          <p className="flex justify-between gap-3">
            <span>Item funds available for buyer-authorized release</span>
            <span className="tabular-nums text-white">
              {formatMinor(
                ticket.breakdown.releaseStructure.itemFundsReleasedEarlyMinor,
                cur,
              )}
            </span>
          </p>
          <p className="flex justify-between gap-3">
            <span>Remaining seller funds protected</span>
            <span className="tabular-nums text-white">
              {formatMinor(
                ticket.breakdown.releaseStructure
                  .remainingProtectedSellerShareMinor,
                cur,
              )}
            </span>
          </p>
          <p className="text-white/40">
            (shipping + sourcer fee — not the Source Bridge fee)
          </p>
          <p className="flex justify-between gap-3">
            <span>Source Bridge fee</span>
            <span className="tabular-nums text-white">
              {formatMinor(
                ticket.breakdown.releaseStructure.platformFeeHeldMinor,
                cur,
              )}
            </span>
          </p>
          <p className="text-white/40">
            Shipping is never released early. Buyer must authorize item funds
            after funding.
          </p>
        </div>
      ) : null}

      {procAgreed && ticket.status !== "FUNDED" && !procTransferred && !ticket.breakdown.releaseStructure ? (
        <p className="mt-3 text-xs text-white/50">
          Item funds advance: {formatMinor(ticket.procurementAdvanceMinor, cur)}{" "}
          — buyer-authorized after funding (not automatic).
        </p>
      ) : null}

      {ticket.status === "FUNDED" && !procTransferred && !isCompleted ? (
        <p className="mt-3 text-xs text-emerald-300/90">
          Funded and held on platform. No transfer yet
          {procAgreed
            ? " — release item funds when ready to authorize procurement."
            : " — seller payout waits until delivery/inspection."}
        </p>
      ) : null}

      {showItemFundsRemainingProtected ? (
        <p className="mt-3 text-xs text-amber-200/80">
          Item funds have been released to the sourcer. The remaining{" "}
          {formatMinor(remainingSellerEntitlement, cur)} stays protected until
          delivery and buyer approval.
        </p>
      ) : null}

      {isCompleted ? (
        <div
          className="mt-3 space-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-white/70"
          data-testid="ticket-completed-receipt"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300/90">
            COMPLETED · {completedSubstatus || "Funds Settled"}
          </p>
          <p className="flex justify-between gap-3">
            <span>Buyer refund</span>
            <span className="tabular-nums text-white">
              {formatMinor(ticket.books?.refundedMinor ?? 0, cur)}
            </span>
          </p>
          <p className="flex justify-between gap-3">
            <span>Sourcer release</span>
            <span className="tabular-nums text-white">
              {formatMinor(
                (ticket.books?.procurementTransferredMinor ?? 0) +
                  (ticket.books?.finalTransferredMinor ?? 0),
                cur,
              )}
            </span>
          </p>
          <p className="flex justify-between gap-3">
            <span>Source Bridge fee retained</span>
            <span className="tabular-nums text-white">
              {formatMinor(platformFeeHeld, cur)}
            </span>
          </p>
          <p className="flex justify-between gap-3">
            <span>Remaining protected</span>
            <span className="tabular-nums text-white">
              {formatMinor(0, cur)}
            </span>
          </p>
        </div>
      ) : null}

      {iAmSeller && ticket.status === "FUNDED" && procAgreed && !procTransferred ? (
        <p className="mt-3 text-xs text-white/45">
          Waiting for buyer to release item funds. Sourcers cannot authorize
          release.
        </p>
      ) : null}

      {showFulfilment ? (
        <div className="mt-4 space-y-3 rounded-lg border border-white/12 bg-white/[0.03] px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
            Fulfilment
          </p>
          {procAgreed || itemFundsReceived > 0 ? (
            <div className="space-y-1 text-xs text-white/70">
              <p className="flex justify-between gap-3">
                <span>Item funds already released</span>
                <span className="tabular-nums text-white">
                  {formatMinor(itemFundsReceived, cur)}
                </span>
              </p>
              <p className="flex justify-between gap-3">
                <span>Remaining seller funds protected</span>
                <span className="tabular-nums text-white">
                  {formatMinor(
                    ticket.books?.finalResidualMinor ??
                      remainingSellerFundsProtected,
                    cur,
                  )}
                </span>
              </p>
              <p className="flex justify-between gap-3">
                <span>Source Bridge fee (held)</span>
                <span className="tabular-nums text-white">
                  {formatMinor(platformFeeHeld, cur)}
                </span>
              </p>
            </div>
          ) : (
            <p className="text-xs text-white/55">
              Seller earnings remain protected until you choose release,
              inspection completes, or an issue is resolved.
            </p>
          )}

          {hasTracking ? (
            <div className="space-y-1 border-t border-white/10 pt-2 text-xs text-white/70">
              <p className="font-medium text-white/85">SHIPPED</p>
              <p>
                Carrier:{" "}
                <span className="text-white">
                  {ticket.trackingCarrier || "—"}
                </span>
              </p>
              <p>
                Tracking:{" "}
                <span className="font-mono text-white">
                  {ticket.trackingNumber}
                </span>
              </p>
              {ticket.shippedAt ? (
                <p className="text-white/45">
                  Shipped{" "}
                  {new Date(ticket.shippedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              ) : null}
              {ticket.shipmentPhotoUrl ? (
                <div className="space-y-2 pt-1">
                  <p className="text-white/55">Shipping proof submitted</p>
                  <button
                    type="button"
                    onClick={() => setShippingPhotoRevealed((v) => !v)}
                    className="rounded-lg border border-white/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/80 hover:border-electric/40 hover:text-white"
                    data-testid="ticket-shipping-photo-toggle"
                  >
                    {shippingPhotoRevealed
                      ? "Hide shipping photo"
                      : "Reveal shipping photo"}
                  </button>
                  {shippingPhotoRevealed ? (
                    <div
                      className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-black/80 p-4"
                      role="dialog"
                      aria-modal
                      data-testid="ticket-shipping-photo-lightbox"
                      onClick={() => setShippingPhotoRevealed(false)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ticket.shipmentPhotoUrl}
                        alt="Shipping proof"
                        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              {residualProtected > 0 && !isProductPurchase ? (
                <p className="text-white/45">
                  Remaining {formatMinor(residualProtected, cur)} stays protected
                  until inspection completes.
                </p>
              ) : null}
              {isProductPurchase && residualProtected > 0 ? (
                <p className="text-white/45">
                  Remaining {formatMinor(residualProtected, cur)} stays protected.
                  Admin controls release or refund — buyers can view and report
                  an issue.
                </p>
              ) : null}
            </div>
          ) : null}

          {canMarkShipped ? (
            <div className="space-y-2 border-t border-white/10 pt-2">
              <label className="block text-xs text-white/55">
                Carrier
                <input
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
                  placeholder="e.g. Royal Mail"
                  disabled={busy}
                />
              </label>
              <label className="block text-xs text-white/55">
                Tracking number
                <input
                  value={trackingInput}
                  onChange={(e) => setTrackingInput(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 font-mono text-sm text-white"
                  placeholder="Tracking number"
                  minLength={4}
                  disabled={busy}
                />
              </label>
              {listingProtectedShipmentPhotoRequired({
                origin: ticket.origin,
                paymentOption: ticket.paymentOption,
              }) ? (
                <div className="space-y-2">
                  <p className="text-xs text-white/55">Shipment photo (required)</p>
                  <AddPhotoControl
                    userId={sessionViewerId || "seller"}
                    folder="misc"
                    maxCount={1}
                    urls={shipmentPhotoUrl ? [shipmentPhotoUrl] : []}
                    onChange={(next) => {
                      const url = next[0] || "";
                      setShipmentPhotoUrl(url);
                      setShipmentPhotoPreview(url);
                    }}
                    disabled={busy || photoBusy}
                    label="ADD PHOTO"
                    testId="ticket-shipment-add-photo"
                  />
                  {!shipmentPhotoUrl ? (
                    <p className="text-[11px] text-white/40">
                      Photo of the packed item is required for protected listing
                      sales.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className="text-[11px] text-white/40">
                You cannot mark delivered. Residual stays protected until buyer
                confirmation / inspection.
              </p>
              <button
                type="button"
                disabled={
                  busy ||
                  photoBusy ||
                  trackingInput.trim().length < 4 ||
                  (listingProtectedShipmentPhotoRequired({
                    origin: ticket.origin,
                    paymentOption: ticket.paymentOption,
                  }) &&
                    !shipmentPhotoUrl)
                }
                onClick={() => void markShipped()}
                className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
              >
                {busy ? "Saving…" : isProductPurchaseOrigin(ticket.origin) ? "Submit Shipping Proof" : "Mark as Shipped"}
              </button>
            </div>
          ) : null}

          {canConfirmReceipt ? (
            <div className="border-t border-white/10 pt-2">
              <p className="mb-2 text-xs font-medium text-white/90">
                Item shipped
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitReceiptDecision("ACKNOWLEDGE")}
                className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
              >
                {busy ? "Saving…" : "Confirm Item Received"}
              </button>
            </div>
          ) : null}

          {canReleaseNow &&
          !disputeResolved &&
          !inInspection &&
          !canConfirmReceipt &&
          ticket.protectedTxnStatus === "DELIVERED" ? (
            <div className="space-y-2 border-t border-white/10 pt-2 text-xs text-white/75">
              <p className="font-medium text-white/90">Item received — choose one:</p>
              {residualProtected > 0 ? (
                <p className="text-white/45">
                  Remaining seller residual{" "}
                  {formatMinor(residualProtected, cur)}
                  {itemFundsReceived > 0
                    ? ` (after ${formatMinor(itemFundsReceived, cur)} item funds already released)`
                    : ""}
                  . Source Bridge fee stays on platform.
                </p>
              ) : null}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submitReceiptDecision("RELEASE_NOW")}
                  className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
                >
                  {busy ? "Working…" : "Release Funds Now"}
                </button>
                <button
                  type="button"
                  disabled={busy || pendingAction === "START_INSPECTION"}
                  onClick={() => void submitReceiptDecision("START_INSPECTION")}
                  className="rounded-lg border border-white/25 bg-white/5 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                  data-testid="ticket-start-inspection"
                >
                  {pendingAction === "START_INSPECTION"
                    ? "Starting inspection…"
                    : "Start 12-Hour Inspection"}
                </button>
              </div>
              <p className="text-[11px] text-white/40">
                If something is wrong after you start inspection, you can
                report a problem during the inspection window.
              </p>
            </div>
          ) : null}

          {isProductPurchase &&
          !inInspection &&
          !disputeResolved &&
          canReportIssue &&
          !issueOpen ? (
            <div className="space-y-2 border-t border-white/10 pt-2 text-xs text-white/75">
              <p className="text-white/50">
                View shipping details above. Report an issue if something is
                wrong — Source Bridge admin controls release or refund.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => setIssueOpen(true)}
                className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs text-amber-100 disabled:opacity-50"
                data-testid="ticket-product-report-issue"
              >
                Report a Problem
              </button>
            </div>
          ) : null}

          {!disputeResolved &&
          ((inInspection && (canReleaseNow || canReportIssue)) ||
            (isProductPurchase && canReportIssue && issueOpen)) ? (
            <div className="space-y-2 border-t border-white/10 pt-2 text-xs text-white/75">
              {inInspection ? (
                ticket.inspectionEndsAt ? (
                  <p className="text-white/50">
                    Inspection ends{" "}
                    {new Date(ticket.inspectionEndsAt).toLocaleString()}
                    {" — "}remaining residual auto-releases after this deadline
                    unless you release early or report a problem.
                  </p>
                ) : (
                  <p className="text-white/50">
                    Inspection in progress — remaining funds stay protected until
                    release or a reported issue.
                  </p>
                )
              ) : (
                <p className="text-white/50">
                  Describe the issue. Admin will decide refund or seller release.
                </p>
              )}
              {inInspection ? (
                <div className="flex flex-wrap gap-2">
                  {canReleaseNow ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submitReceiptDecision("RELEASE_NOW")}
                      className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
                    >
                      {busy ? "Releasing…" : "Release Funds Now"}
                    </button>
                  ) : null}
                  {canReportIssue && !issueOpen ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setIssueOpen(true)}
                      className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs text-amber-100 disabled:opacity-50"
                    >
                      Report a Problem
                    </button>
                  ) : null}
                </div>
              ) : null}
              {issueOpen ? (
                <div className="space-y-2 rounded-lg border border-amber-400/25 bg-amber-400/5 p-2">
                  <label className="block text-xs text-white/60">
                    Issue category
                    <select
                      value={issueCategory}
                      onChange={(e) => setIssueCategory(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
                      disabled={busy}
                    >
                      {PAYMENT_ISSUE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </label>
                  {issueCategory === "Other" ? (
                    <label className="block text-xs text-white/60">
                      Describe the issue
                      <input
                        value={issueReason}
                        onChange={(e) => setIssueReason(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
                        placeholder="Brief summary"
                        disabled={busy}
                        maxLength={200}
                      />
                    </label>
                  ) : null}
                  <label className="block text-xs text-white/60">
                    Details (optional)
                    <textarea
                      value={issueDetails}
                      onChange={(e) => setIssueDetails(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
                      rows={2}
                      disabled={busy}
                      maxLength={4000}
                    />
                  </label>
                  <div className="space-y-2">
                    {sessionViewerId ? (
                      <AddPhotoControl
                        userId={sessionViewerId}
                        folder="misc"
                        maxCount={1}
                        urls={issueEvidenceUrls}
                        onChange={setIssueEvidenceUrls}
                        disabled={busy || photoBusy}
                        label="ADD PHOTO EVIDENCE"
                        testId="ticket-add-photo-evidence"
                      />
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={
                        busy ||
                        (issueCategory === "Other"
                          ? issueReason.trim().length < 3
                          : !issueCategory.trim())
                      }
                      onClick={() => void submitReceiptDecision("REPORT_ISSUE")}
                      className="rounded-lg bg-amber-400/90 px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
                    >
                      {busy ? "Submitting…" : "Submit issue & hold funds"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setIssueOpen(false)}
                      className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {issueHold ? (
            <p
              className="border-t border-white/10 pt-2 text-xs text-amber-200/90"
              data-sb-dispute-banner={
                ticket.openDisputeStatus === "UNDER_REVIEW"
                  ? "under-review"
                  : "frozen"
              }
            >
              {ticket.openDisputeStatus === "UNDER_REVIEW"
                ? "UNDER REVIEW BY SOURCE BRIDGE — The Buyer reported an issue with the item. Source Bridge is reviewing the issue."
                : ticket.openDisputeStatus === "OPEN"
                  ? "The Buyer reported an issue with the item. Source Bridge is reviewing the issue."
                : `Issue reported — remaining seller funds stay protected; auto-release is frozen${
                    itemFundsReceived > 0
                      ? ` (earlier item funds ${formatMinor(itemFundsReceived, cur)} already released stay with the sourcer)`
                      : ""
                  }.`}
            </p>
          ) : null}

          {disputeResolved ? (
            <div
              className="space-y-1 border-t border-white/10 pt-2 text-xs text-white/75"
              data-testid="ticket-dispute-receipt"
            >
              <p className="font-medium text-white/90">Issue resolved</p>
              <p>
                Outcome: {(ticket.openDisputeStatus || "").replace(/_/g, " ")}
              </p>
              {refundedMinor > 0 ? (
                <p>Refunded to buyer: {formatMinor(refundedMinor, cur)}</p>
              ) : null}
              {releasedMinor > 0 ? (
                <p>Released to sourcer: {formatMinor(releasedMinor, cur)}</p>
              ) : null}
              {platformFeeHeld > 0 ? (
                <p>
                  Source Bridge fee retained: {formatMinor(platformFeeHeld, cur)}
                </p>
              ) : null}
              {ticket.openDisputeResolutionNote ? (
                <p className="text-white/50">{ticket.openDisputeResolutionNote}</p>
              ) : null}
            </div>
          ) : null}

          {!disputeResolved &&
          !inInspection &&
          !canConfirmReceipt &&
          ticket.inspectionEndsAt &&
          (ticket.protectedTxnStatus === "READY_TO_RELEASE" ||
            ticket.lifecycleStage === "READY_TO_RELEASE") ? (
            <p className="text-xs text-white/50">
              Inspection complete — residual release in progress.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-3 text-xs text-amber-300">{error}</p> : null}
      {payNotice && !checkout ? (
        <p className="mt-3 text-xs text-electric">{payNotice}</p>
      ) : null}

      {!historical ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {acceptDeclineButtons}
          {acceptance.waitingForOther ? (
            <p className="text-xs text-white/45">{acceptance.waitingLabel}</p>
          ) : null}
          {acceptance.bothAcceptedCurrentRevision &&
          ticket.status === "ACCEPTED" &&
          !canPay &&
          !sellerMustOnboard ? (
            <p className="text-xs text-white/45">
              {acceptance.bothAcceptedLabel}
              {iAmSeller ? ". Waiting for buyer payment." : "."}
            </p>
          ) : null}
          {connectSetupBlock}
          {canPay && !checkout ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startPay()}
              className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
            >
              {payFailed ? "Try Payment Again" : "Make Payment"}
            </button>
          ) : null}
          {showPaymentProcessing && !checkout ? (
            <span
              data-testid="ticket-payment-processing"
              className="inline-flex items-center rounded-lg border border-electric/40 bg-electric/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-electric"
            >
              Payment processing
            </span>
          ) : null}
          {canRelease && !confirmRelease ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmRelease(true)}
              className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
            >
              Release Item Funds
            </button>
          ) : null}
        </div>
      ) : null}

      {confirmCancel && mounted
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-end justify-center bg-black/65 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] md:items-center md:p-4"
              data-sb-ticket-confirm="cancel"
              onClick={(e) => {
                if (e.target === e.currentTarget && !busy) setConfirmCancel(false);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Cancel payment agreement"
                className="flex max-h-[min(100dvh,100%)] w-full min-w-0 max-w-md flex-col overflow-hidden rounded-xl border border-amber-400/30 bg-[#061228] shadow-xl md:max-h-[min(85dvh,24rem)]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex shrink-0 items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200/90">
                    Cancel agreement
                  </p>
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(false)}
                    disabled={busy}
                    className="rounded-md p-1 text-white/50 hover:text-white"
                    aria-label="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 text-xs text-white/80">
                  <p>
                    Cancel this payment agreement? It becomes non-actionable. No
                    funds will move. You can propose a new Payment Ticket
                    afterward.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 border-t border-white/10 px-4 py-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void cancelAgreement()}
                    className="min-h-11 flex-1 rounded-lg bg-amber-400/90 px-3 py-2 text-xs font-medium text-app-navy disabled:opacity-50"
                  >
                    {busy ? "Cancelling…" : "Confirm cancel"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmCancel(false)}
                    className="min-h-11 flex-1 rounded-lg border border-white/20 px-3 py-2 text-xs text-white/70"
                  >
                    Keep agreement
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {confirmDelete && mounted
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-end justify-center bg-black/65 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] md:items-center md:p-4"
              data-sb-ticket-confirm="delete"
              onClick={(e) => {
                if (e.target === e.currentTarget && !busy) setConfirmDelete(false);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Delete proposed Payment Ticket"
                className="flex max-h-[min(100dvh,100%)] w-full min-w-0 max-w-md flex-col overflow-hidden rounded-xl border border-red-400/30 bg-[#061228] shadow-xl md:max-h-[min(85dvh,24rem)]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex shrink-0 items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-300/90">
                    Delete ticket
                  </p>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={busy}
                    className="rounded-md p-1 text-white/50 hover:text-white"
                    aria-label="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 text-xs text-white/80">
                  <p>
                    Delete this proposed Payment Ticket? It will disappear from
                    the timeline. This only works for unfunded tickets that were
                    never fully accepted.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 border-t border-white/10 px-4 py-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteTicket()}
                    className="min-h-11 flex-1 rounded-lg bg-red-400/90 px-3 py-2 text-xs font-medium text-app-navy disabled:opacity-50"
                  >
                    {busy ? "Deleting…" : "Confirm delete"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmDelete(false)}
                    className="min-h-11 flex-1 rounded-lg border border-white/20 px-3 py-2 text-xs text-white/70"
                  >
                    Keep ticket
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {confirmRelease ? (
        <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-3 text-xs text-white/80">
          <p>
            Release{" "}
            {formatMinor(ticket.procurementAdvanceMinor, cur)} item funds to the
            sourcer now? Shipping and remaining amounts stay protected. This
            cannot be silently reversed.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void releaseItemFunds()}
              className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
            >
              {busy ? "Releasing…" : "Confirm release"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmRelease(false)}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {editOpen && canEdit && ticket.conversationId ? (
        <div className="mt-3">
          <ProposePaymentTicketButton
            conversationId={ticket.conversationId}
            myId={myId}
            otherUserId={iAmBuyer ? ticket.sellerId : ticket.buyerId}
            otherUsername={
              iAmBuyer
                ? ticket.sellerParty?.username
                : ticket.buyerParty?.username
            }
            otherDisplayName={
              iAmBuyer ? ticket.sellerParty?.name : ticket.buyerParty?.name
            }
            hideTrigger
            forceOpen
            editFromTicket={{
              conversationId: ticket.conversationId,
              reviseFromTicketId: ticket.id,
              title: ticket.title,
              currency: ticket.currency,
              itemCostMinor: ticket.itemCostMinor,
              shippingMinor: ticket.shippingMinor,
              sellerServiceFeeMinor: ticket.sellerServiceFeeMinor,
              procurementAdvanceAgreed: ticket.procurementAdvanceAgreed,
              notes: ticket.notes || "",
              buyerId: ticket.buyerId,
              sellerId: ticket.sellerId,
            }}
            onCloseEdit={() => setEditOpen(false)}
            onCreated={() => {
              setEditOpen(false);
              void load();
              onChanged?.();
            }}
          />
        </div>
      ) : null}

      {checkout &&
      ticketMayShowPayUi({
        ticketStatus: ticket.status,
        protectedStatus: ticket.protectedTxnStatus ?? null,
        fundedAt: ticket.fundedAt ?? null,
        paymentIntentStatus: ticket.paymentIntentStatus ?? null,
        lifecycleStage: ticket.lifecycleStage ?? null,
      }) ? (
        <ProtectedPaymentCheckout
          clientSecret={checkout.clientSecret}
          publishableKey={checkout.publishableKey}
          amountMinor={checkout.amountMinor}
          currency={checkout.currency}
          paymentMode={isDirect ? "direct" : "protected"}
          protectedTxnId={ticket.protectedTransactionId || undefined}
          ordersHref="/profile/purchases"
          returnPath="/inbox?payment=return"
          onDismiss={() => setCheckout(null)}
          onPaymentSubmitted={() => {
            setCheckout(null);
            setPaymentSubmitted(true);
            setPayFailed(false);
            setPayNotice(
              "Payment received. Funds stay on the platform until release rules. Do not pay again.",
            );
            void load();
            onChanged?.();
          }}
          onPaymentFailed={() => {
            setPayFailed(true);
            setPaymentSubmitted(false);
          }}
        />
      ) : null}
    </div>
  );
}
