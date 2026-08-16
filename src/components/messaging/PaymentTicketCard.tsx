"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, MoreHorizontal, ShieldCheck } from "lucide-react";
import { formatMinor } from "@/lib/payments/money";
import { ProtectedPaymentCheckout } from "@/components/payments/ProtectedPaymentCheckout";
import {
  ProposePaymentTicketButton,
} from "@/components/messaging/ProposePaymentTicketButton";
import {
  getPaymentTicketActions,
  isCompletedLifecycleTicket,
  isSubtleHistoricalTicket,
  isTerminalLifecycleStage,
  resolveAuthoritativeViewerId,
  resolveLifecycleStage,
  shouldShowItemFundsRemainingProtectedMessage,
  subtleHistoricalLabel,
  ticketAppearsInChatTimeline,
  waitingCopyAddressesViewer,
} from "@/lib/payments/ticket-lifecycle";

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
  procurementAdvanceAgreed: boolean;
  procurementAdvanceMinor: number;
  buyerId: string;
  sellerId: string;
  buyerApprovedRevision: number | null;
  sellerApprovedRevision: number | null;
  protectedTransactionId: string | null;
  protectedTxnStatus?: string | null;
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
}: Props) {
  const [ticket, setTicket] = useState<PaymentTicketView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
  const [checkout, setCheckout] = useState<{
    clientSecret: string;
    publishableKey: string;
    amountMinor: number;
    currency: string;
  } | null>(null);
  const [paymentsAccess, setPaymentsAccess] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [trackingInput, setTrackingInput] = useState("");
  const [confirmReceiptOpen, setConfirmReceiptOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueReason, setIssueReason] = useState("");
  const [issueDetails, setIssueDetails] = useState("");

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
        const next = json.ticket as PaymentTicketView;
        // Role-neutral: never persist a previous viewer's identity on the ticket.
        delete (next as { viewer?: unknown }).viewer;
        setTicket(next);
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
    if (ticketSnapshot && ticketSnapshot.id === ticketId) {
      const snap = { ...ticketSnapshot };
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
      const snap = { ...ticketSnapshot };
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
        prev.title === snap.title
      ) {
        return prev;
      }
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
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  // Soft revalidate ticket state while conversation is open (visibility-aware).
  // Skip when the parent conversation poll already supplies ticketSnapshot.
  useEffect(() => {
    if (typeof window === "undefined" || !ticketId) return;
    if (ticketSnapshot && ticketSnapshot.id === ticketId) return;
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
  }, [ticketId, load, ticketSnapshot?.id]);

  // After return from 3DS: poll — funding only when webhook sets FUNDED.
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

  async function respond(action: "accept" | "decline") {
    setBusy(true);
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
        setTicket(json.ticket);
        onChanged?.();
      }
    } catch {
      setError("Action failed");
    } finally {
      setBusy(false);
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
        clientSecret?: string;
        publishableKey?: string;
        amountMinor?: number;
        currency?: string;
      };
      if (!res.ok) {
        setError(json.error || "Checkout unavailable");
      } else if (json.clientSecret && json.publishableKey) {
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
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(json.error || "Could not mark as shipped");
      } else {
        setPayNotice("Marked as shipped. Remaining earnings stay protected.");
        setCarrier("");
        setTrackingInput("");
        await load();
        onChanged?.();
      }
    } catch {
      setError("Could not mark as shipped");
    } finally {
      setBusy(false);
    }
  }

  async function submitReceiptDecision(
    decision: "RELEASE_NOW" | "START_INSPECTION" | "REPORT_ISSUE",
  ) {
    if (!ticket?.protectedTransactionId) return;
    if (decision === "REPORT_ISSUE" && issueReason.trim().length < 3) {
      setError("Describe the issue (min 3 characters)");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/payments/confirm-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protectedTxnId: ticket.protectedTransactionId,
          decision,
          reason:
            decision === "REPORT_ISSUE" ? issueReason.trim() : undefined,
          details:
            decision === "REPORT_ISSUE"
              ? issueDetails.trim() || undefined
              : undefined,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        alreadyConfirmed?: boolean;
        transferTriggered?: boolean;
        decision?: string;
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
        } else {
          setPayNotice(
            json.alreadyConfirmed
              ? "Issue already open — auto-release remains frozen."
              : "Issue reported — remaining funds held; auto-release frozen.",
          );
        }
        setConfirmReceiptOpen(false);
        setIssueOpen(false);
        setIssueReason("");
        setIssueDetails("");
        await load();
        onChanged?.();
      }
    } catch {
      setError("Could not complete decision");
    } finally {
      setBusy(false);
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
    party?.username
      ? `@${party.username.replace(/^@/, "")}`
      : party?.name || null;
  const buyerHandle = partyHandle(ticket.buyerParty) || (iAmBuyer ? "You" : "Buyer");
  const sourcerHandle =
    partyHandle(ticket.sellerParty) || (iAmSeller ? "You" : "Sourcer");
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
  const acceptance = ticketActions.acceptance;
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
    );
  const isCompleted = isCompletedLifecycleTicket({
    ticketStatus: ticket.status,
    protectedStatus: ticket.protectedTxnStatus ?? null,
    lifecycleStage: lifecycleStageResolved,
  });
  const isTerminal =
    isTerminalLifecycleStage(lifecycleStageResolved) || subtleHistorical;
  // Actions / CTAs blocked for all terminal lifecycle stages.
  const historical = isTerminal;
  const open = !historical && (ticket.status === "PROPOSED" || ticket.status === "ACCEPTED");
  const viewerMayAccept = Boolean(sessionViewerId) && acceptance.viewerMayAccept;
  const canRespond = Boolean(open && viewerMayAccept && acceptance.isParty);
  const canPay =
    !historical &&
    paymentsAccess &&
    iAmBuyer &&
    (ticket.status === "ACCEPTED" ||
      ticket.lifecycleStage === "AGREED_AWAITING_PAYMENT") &&
    Boolean(ticket.protectedTransactionId);
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
  const issueHold =
    ticket.protectedTxnStatus === "DISPUTED" ||
    ticket.lifecycleStage === "DISPUTED";
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

  const cur = ticket.currency;
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
        Accept Agreement
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
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full min-w-0 items-start justify-between gap-2 text-left sm:gap-3"
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
                  {isCompleted ? "COMPLETED" : stageLabel}
                </span>
                {needsAction || canRespond ? (
                  <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-200/90">
                    {canRespond
                      ? "Action required · Review Agreement"
                      : "Action required"}
                  </span>
                ) : null}
                <span className="rounded border border-amber-400/25 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-200/70">
                  TEST
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
            Make Payment
          </button>
        ) : null}
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
              {menuOpen ? (
                <div className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-lg border border-white/15 bg-[#061228] py-1 shadow-xl">
                  {canEdit ? (
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-xs text-white/80 hover:bg-white/5"
                      onClick={() => {
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
                      className="block w-full px-3 py-2 text-left text-xs text-amber-200/90 hover:bg-white/5"
                      onClick={() => {
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
                      className="block w-full px-3 py-2 text-left text-xs text-red-300/90 hover:bg-white/5"
                      onClick={() => {
                        setMenuOpen(false);
                        setConfirmDelete(true);
                      }}
                    >
                      Delete Ticket
                    </button>
                  ) : null}
                </div>
              ) : null}
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
            Make Payment
          </button>
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
        <div className="mt-3 space-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-white/70">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300/90">
            Payment completed
          </p>
          <p className="flex justify-between gap-3">
            <span>Seller payment fully released</span>
            <span className="tabular-nums text-white">
              {formatMinor(sellerEntitledMinor, cur)}
            </span>
          </p>
          {itemFundsReceived > 0 ? (
            <>
              <p className="flex justify-between gap-3 text-white/55">
                <span>Item / procurement released</span>
                <span className="tabular-nums">
                  {formatMinor(itemFundsReceived, cur)}
                </span>
              </p>
              <p className="flex justify-between gap-3 text-white/55">
                <span>Final seller funds released</span>
                <span className="tabular-nums">
                  {formatMinor(finalTransferredMinor, cur)}
                </span>
              </p>
            </>
          ) : null}
          <p className="flex justify-between gap-3">
            <span>Remaining protected</span>
            <span className="tabular-nums text-white">
              {formatMinor(0, cur)}
            </span>
          </p>
          <p className="flex justify-between gap-3">
            <span>Source Bridge fee</span>
            <span className="tabular-nums text-white">
              {formatMinor(platformFeeHeld, cur)}
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
              {residualProtected > 0 ? (
                <p className="text-white/45">
                  Remaining {formatMinor(residualProtected, cur)} stays protected
                  until inspection completes.
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
              <p className="text-[11px] text-white/40">
                You cannot mark delivered. Residual stays protected until buyer
                confirmation / inspection.
              </p>
              <button
                type="button"
                disabled={busy || trackingInput.trim().length < 4}
                onClick={() => void markShipped()}
                className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
              >
                {busy ? "Saving…" : "Mark as Shipped"}
              </button>
            </div>
          ) : null}

          {canConfirmReceipt ? (
            <div className="border-t border-white/10 pt-2">
              {!confirmReceiptOpen ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setConfirmReceiptOpen(true);
                    setIssueOpen(false);
                  }}
                  className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
                >
                  Confirm Item Received
                </button>
              ) : (
                <div className="space-y-2 text-xs text-white/75">
                  <p className="font-medium text-white/90">
                    Item received — choose one:
                  </p>
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
                      disabled={busy}
                      onClick={() =>
                        void submitReceiptDecision("START_INSPECTION")
                      }
                      className="rounded-lg border border-white/25 bg-white/5 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                    >
                      Start 12-Hour Inspection
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setConfirmReceiptOpen(false);
                        setIssueOpen(false);
                      }}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="text-[11px] text-white/40">
                    If something is wrong after you start inspection, you can
                    report a problem during the inspection window.
                  </p>
                </div>
              )}
            </div>
          ) : null}

          {inInspection && (canReleaseNow || canReportIssue) ? (
            <div className="space-y-2 border-t border-white/10 pt-2 text-xs text-white/75">
              {ticket.inspectionEndsAt ? (
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
              )}
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
              {issueOpen ? (
                <div className="space-y-2 rounded-lg border border-amber-400/25 bg-amber-400/5 p-2">
                  <label className="block text-xs text-white/60">
                    What went wrong?
                    <input
                      value={issueReason}
                      onChange={(e) => setIssueReason(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
                      placeholder="e.g. Damaged in transit"
                      disabled={busy}
                      maxLength={200}
                    />
                  </label>
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
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy || issueReason.trim().length < 3}
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
            <p className="border-t border-white/10 pt-2 text-xs text-amber-200/90">
              Issue reported — remaining seller funds stay protected; auto-release
              is frozen
              {itemFundsReceived > 0
                ? ` (earlier item funds ${formatMinor(itemFundsReceived, cur)} already released stay with the sourcer)`
                : ""}
              .
            </p>
          ) : null}

          {!inInspection &&
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
          !canPay ? (
            <p className="text-xs text-white/45">
              {acceptance.bothAcceptedLabel}
              {iAmSeller ? ". Waiting for buyer payment." : "."}
            </p>
          ) : null}
          {canPay && !checkout ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startPay()}
              className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
            >
              Make Payment
            </button>
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

      {confirmCancel ? (
        <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-3 text-xs text-white/80">
          <p>
            Cancel this payment agreement? It becomes non-actionable. No funds
            will move. You can propose a new Payment Ticket afterward.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void cancelAgreement()}
              className="rounded-lg bg-amber-400/90 px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
            >
              {busy ? "Cancelling…" : "Confirm cancel"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmCancel(false)}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70"
            >
              Keep agreement
            </button>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="mt-3 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-3 text-xs text-white/80">
          <p>
            Delete this proposed Payment Ticket? It will disappear from the
            timeline. This only works for unfunded tickets that were never
            fully accepted.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void deleteTicket()}
              className="rounded-lg bg-red-400/90 px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Confirm delete"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70"
            >
              Keep ticket
            </button>
          </div>
        </div>
      ) : null}

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

      {checkout ? (
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
            setPayNotice(
              "Payment received. Funds stay on the platform until release rules. Do not pay again.",
            );
            void load();
            onChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}
