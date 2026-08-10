"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MoreHorizontal, ShieldCheck } from "lucide-react";
import { formatMinor } from "@/lib/payments/money";
import { ProtectedPaymentCheckout } from "@/components/payments/ProtectedPaymentCheckout";
import {
  ProposePaymentTicketButton,
} from "@/components/messaging/ProposePaymentTicketButton";

export type PaymentTicketView = {
  id: string;
  conversationId: string;
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
  actions?: {
    canReleaseProcurement?: boolean;
    canPay?: boolean;
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
  proposedAt?: string | null;
  proposedByName?: string | null;
  onChanged?: () => void;
};

export function PaymentTicketCard({
  ticketId,
  myId,
  proposedAt,
  proposedByName,
  onChanged,
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
  const [expanded, setExpanded] = useState(false);
  const [gone, setGone] = useState(false);
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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/payments/tickets/${ticketId}`, {
        cache: "no-store",
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
        setError(json.error || "Could not load Payment Ticket");
        setTicket(null);
      } else {
        setTicket(json.ticket);
      }
    } catch {
      setError("Could not load Payment Ticket");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  // After return from 3DS: poll — funding only when webhook sets FUNDED.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") !== "return") return;
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      void load();
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
        body: JSON.stringify({ action }),
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

  const iAmBuyer = myId === ticket.buyerId;
  const iAmSeller = myId === ticket.sellerId;
  const myApproved = iAmBuyer
    ? ticket.buyerApprovedRevision === ticket.revision
    : iAmSeller
      ? ticket.sellerApprovedRevision === ticket.revision
      : false;
  const historical =
    ticket.status === "DECLINED" ||
    ticket.status === "SUPERSEDED" ||
    ticket.status === "CANCELLED" ||
    ticket.status === "DELETED" ||
    ticket.status === "VOIDED";
  const open = !historical && (ticket.status === "PROPOSED" || ticket.status === "ACCEPTED");
  const canRespond =
    open && ticket.status === "PROPOSED" && !myApproved && (iAmBuyer || iAmSeller);
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
  const platformFeeHeld =
    ticket.books?.platformFeeMinor ?? ticket.protectionFeeMinor ?? 0;
  const itemFundsReceived =
    ticket.books?.procurementTransferredMinor ?? 0;
  const canEdit = Boolean(ticket.actions?.canEdit);
  const canCancel = Boolean(ticket.actions?.canCancel);
  const canDelete = Boolean(ticket.actions?.canDelete);
  const showMenu = canEdit || canCancel || canDelete;
  const stageLabel =
    ticket.lifecycleLabel ||
    ticket.lifecycleStage ||
    ticket.status;
  const proposerLabel =
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

  // Historical: collapsed subdued card, expandable to view terms.
  if (historical && !expanded) {
    return (
      <div className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 opacity-75">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-white/35" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
                Payment Ticket · v{ticket.revision}
              </p>
              <p className="mt-0.5 text-sm text-white/55">
                {ticket.title || "Payment Ticket"} · {stageLabel}
              </p>
            </div>
          </div>
          <span className="text-[10px] text-white/35">View</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={
        historical
          ? "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 opacity-80"
          : "w-full rounded-xl border border-electric/35 bg-[#07152c] px-4 py-4"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck
            size={18}
            className={historical ? "text-white/40" : "text-electric"}
          />
          <div>
            <p
              className={
                historical
                  ? "text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40"
                  : "text-[10px] font-semibold uppercase tracking-[0.16em] text-electric"
              }
            >
              Protected Payment
            </p>
            <p className="mt-0.5 text-sm font-medium text-white">
              {ticket.title || "Payment Ticket"} · v{ticket.revision}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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

      {historical ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-1 text-[10px] text-white/40 hover:text-white/60"
        >
          Collapse
        </button>
      ) : null}

      {proposerLabel || proposedWhen ? (
        <p className="mt-2 text-xs text-white/45">
          Proposed by {proposerLabel || "member"}
          {proposedWhen ? ` · ${formatProposedTime(proposedWhen)}` : ""}
        </p>
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
        <p className="font-medium text-white/70">Dual-accept status</p>
        <p>
          Buyer:{" "}
          {ticket.buyerApprovedRevision === ticket.revision
            ? "accepted this revision"
            : "not yet accepted"}
        </p>
        <p>
          Seller:{" "}
          {ticket.sellerApprovedRevision === ticket.revision
            ? "accepted this revision"
            : "not yet accepted"}
        </p>
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
          <p>
            {ticket.breakdown.releaseStructure
              ? "Item funds released early"
              : "Item funds"}
            :{" "}
            {formatMinor(
              ticket.breakdown.releaseStructure.itemFundsReleasedEarlyMinor,
              cur,
            )}{" "}
            (after buyer authorizes — not on fund)
          </p>
          <p>
            Remaining protected:{" "}
            {formatMinor(
              ticket.breakdown.releaseStructure
                .remainingProtectedSellerShareMinor +
                ticket.breakdown.releaseStructure.platformFeeHeldMinor,
              cur,
            )}{" "}
            (shipping, sourcer fee, SB fee)
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

      {ticket.status === "FUNDED" && !procTransferred ? (
        <p className="mt-3 text-xs text-emerald-300/90">
          Funded and held on platform. No transfer yet
          {procAgreed
            ? " — release item funds when ready to authorize procurement."
            : " — seller payout waits until delivery/inspection."}
        </p>
      ) : null}

      {procTransferred ? (
        <p className="mt-3 text-xs text-amber-200/80">
          Item funds released to sourcer. Remaining amount stays protected until
          delivery — this is not full protection on the full total.
        </p>
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
                  {formatMinor(residualProtected, cur)}
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
                      onClick={() => setIssueOpen(true)}
                      className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs text-amber-100 disabled:opacity-50"
                    >
                      Report a Problem
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
                  {issueOpen ? (
                    <div className="space-y-2 rounded-lg border border-amber-400/25 bg-amber-400/5 p-2">
                      <label className="block text-xs text-white/60">
                        What went wrong?
                        <input
                          value={issueReason}
                          onChange={(e) => setIssueReason(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
                          placeholder="e.g. Item not as described"
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
                      <button
                        type="button"
                        disabled={busy || issueReason.trim().length < 3}
                        onClick={() =>
                          void submitReceiptDecision("REPORT_ISSUE")
                        }
                        className="rounded-lg bg-amber-400/90 px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
                      >
                        {busy ? "Submitting…" : "Submit issue & hold funds"}
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {inInspection && canReleaseNow ? (
            <div className="space-y-2 border-t border-white/10 pt-2 text-xs text-white/75">
              {ticket.inspectionEndsAt ? (
                <p className="text-white/50">
                  Inspection ends{" "}
                  {new Date(ticket.inspectionEndsAt).toLocaleString()}
                  {" — "}auto-release after window unless you act sooner.
                </p>
              ) : (
                <p className="text-white/50">Inspection in progress.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submitReceiptDecision("RELEASE_NOW")}
                  className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
                >
                  {busy ? "Releasing…" : "Release Funds Now"}
                </button>
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
          {canRespond ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void respond("accept")}
                className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
              >
                Accept terms
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void respond("decline")}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70 hover:border-white/40 disabled:opacity-50"
              >
                Decline
              </button>
            </>
          ) : null}
          {ticket.status === "PROPOSED" && myApproved ? (
            <p className="text-xs text-white/45">Waiting for the other party…</p>
          ) : null}
          {canPay && !checkout ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startPay()}
              className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
            >
              Pay securely
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
            hideTrigger
            forceOpen
            editFromTicket={{
              conversationId: ticket.conversationId,
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
