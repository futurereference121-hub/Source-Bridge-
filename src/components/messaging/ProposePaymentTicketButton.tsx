"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Loader2, ShieldCheck, X } from "lucide-react";
import type { PaymentTicketView } from "@/components/messaging/PaymentTicketCard";

/** Deploy/build fingerprint for production diagnostics (safe, non-secret). */
declare global {
  interface Window {
    __SB_PAYMENT_TICKET_BUILD__?: string;
  }
}

export type ProposedTicketTimelineMessage = {
  id: string;
  conversationId: string;
  senderId: string | null;
  body: string;
  createdAt: string;
  messageType?: string;
  systemEventType?: string;
  replyAllowed?: boolean;
  paymentTicketId?: string | null;
  attachments?: {
    id: string;
    url: string;
    pathname: string;
    mimeType: string;
    sizeBytes: number;
  }[];
  sender?: {
    id: string;
    name: string;
    username: string | null;
    slug: string | null;
    photo: string;
  };
};

export type PaymentsProposalAccess = {
  allowlistConfigured?: boolean;
  testRampOpen?: boolean;
  flagsOn?: boolean;
  selfAllowed?: boolean;
  peerAllowed?: boolean;
  bothAllowed?: boolean;
  peerPresent?: boolean;
};

export type EditTicketPrefill = {
  conversationId: string;
  /** Specific ticket to supersede (required for multi-ticket conversations). */
  reviseFromTicketId?: string;
  title?: string;
  currency?: string;
  itemCostMinor: number;
  shippingMinor?: number;
  sellerServiceFeeMinor?: number;
  procurementAdvanceAgreed?: boolean;
  notes?: string;
  buyerId?: string;
  sellerId?: string;
};

type ProposePaymentTicketButtonProps = {
  conversationId: string;
  myId: string;
  /** The other conversation participant (required for explicit Buyer selection). */
  otherUserId?: string;
  otherUsername?: string | null;
  otherDisplayName?: string | null;
  /**
   * From conversation GET. TEST ramp is open when Live is off — both parties
   * may propose/accept subject to normal eligibility (not demo/admin).
   */
  proposalAccess?: PaymentsProposalAccess | null;
  onCreated?: (payload: {
    ticket: PaymentTicketView;
    message: ProposedTicketTimelineMessage | null;
  }) => void;
  /** Prefill + revise mode (supersedes the given ticket via createOrRevise). */
  editFromTicket?: EditTicketPrefill | null;
  forceOpen?: boolean;
  onCloseEdit?: () => void;
  /** When true, hide the compact toolbar button (card-embedded revise form). */
  hideTrigger?: boolean;
  /** Active (non-terminal) ticket count for this conversation. */
  activeTicketCount?: number;
  /** Server cap; defaults to 3. */
  maxActiveTickets?: number;
  /** Dropdown opens below (header) or above (legacy composer). */
  panelPlacement?: "above" | "below";
};

const BUILD_FINGERPRINT = "pt-propose-v8-viewport-dialog";

function minorToMajor(minor: number | undefined): string {
  if (minor == null || !Number.isFinite(minor)) return "0";
  return (minor / 100).toFixed(2);
}

/**
 * Compact action to propose a Payment Ticket (no funding).
 * Visible when TEST payments are enabled for eligible authenticated users.
 *
 * IMPORTANT: Must NOT use a nested <form> inside MessagesInbox's compose <form>
 * (invalid HTML; browsers ignore the nested form and route submit to the
 * message sender instead — silent no-ticket + no error).
 */
export function ProposePaymentTicketButton({
  conversationId,
  myId,
  otherUserId,
  otherUsername,
  otherDisplayName,
  proposalAccess,
  onCreated,
  editFromTicket,
  forceOpen,
  onCloseEdit,
  hideTrigger,
  activeTicketCount = 0,
  maxActiveTickets = 3,
}: ProposePaymentTicketButtonProps) {
  const isEdit = Boolean(editFromTicket);
  const convId = editFromTicket?.conversationId || conversationId;
  const atActiveLimit =
    !isEdit && activeTicketCount >= maxActiveTickets;

  const [open, setOpen] = useState(Boolean(forceOpen || editFromTicket));
  const [itemMajor, setItemMajor] = useState(
    editFromTicket ? minorToMajor(editFromTicket.itemCostMinor) : "",
  );
  const [shippingMajor, setShippingMajor] = useState(
    editFromTicket ? minorToMajor(editFromTicket.shippingMinor ?? 0) : "0",
  );
  const [serviceMajor, setServiceMajor] = useState(
    editFromTicket
      ? minorToMajor(editFromTicket.sellerServiceFeeMinor ?? 0)
      : "0",
  );
  const [title, setTitle] = useState(editFromTicket?.title || "");
  const [currency, setCurrency] = useState(editFromTicket?.currency || "GBP");
  const [procurement, setProcurement] = useState(
    Boolean(editFromTicket?.procurementAdvanceAgreed),
  );
  const [buyerIsMe, setBuyerIsMe] = useState<boolean | null>(() => {
    if (editFromTicket?.buyerId) return editFromTicket.buyerId === myId;
    return null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(isEdit);
  const [procurementFlag, setProcurementFlag] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      window.__SB_PAYMENT_TICKET_BUILD__ = BUILD_FINGERPRINT;
    }
  }, []);

  useEffect(() => {
    if (forceOpen || editFromTicket) {
      setOpen(true);
    }
  }, [forceOpen, editFromTicket]);

  useEffect(() => {
    if (!editFromTicket) return;
    setItemMajor(minorToMajor(editFromTicket.itemCostMinor));
    setShippingMajor(minorToMajor(editFromTicket.shippingMinor ?? 0));
    setServiceMajor(minorToMajor(editFromTicket.sellerServiceFeeMinor ?? 0));
    setTitle(editFromTicket.title || "");
    setCurrency(editFromTicket.currency || "GBP");
    setProcurement(Boolean(editFromTicket.procurementAdvanceAgreed));
    setBuyerIsMe(editFromTicket.buyerId ? editFromTicket.buyerId === myId : null);
  }, [editFromTicket, myId]);

  useEffect(() => {
    if (!open || isEdit) return;
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) closeForm();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, isEdit, busy]);

  useEffect(() => {
    void fetch("/api/payments/connect", { cache: "no-store" })
      .then((r) => r.json())
      .then(
        (j: {
          flags?: {
            PROTECTED_PAYMENTS_ENABLED?: boolean;
            INSTANT_PAYMENTS_ENABLED?: boolean;
            PROCUREMENT_ADVANCES_ENABLED?: boolean;
            PAYMENTS_TEST_ALLOWLIST_CONFIGURED?: boolean;
            PAYMENTS_TEST_RAMP_OPEN?: boolean;
          };
          paymentsAccess?: { testAccessAllowed?: boolean; testRampOpen?: boolean };
        }) => {
          const flagOn = Boolean(
            j.flags?.PROTECTED_PAYMENTS_ENABLED ||
              j.flags?.INSTANT_PAYMENTS_ENABLED,
          );
          const access = Boolean(
            j.paymentsAccess?.testAccessAllowed ??
              j.flags?.PAYMENTS_TEST_RAMP_OPEN,
          );
          setEnabled(isEdit || (flagOn && access));
          setProcurementFlag(Boolean(j.flags?.PROCUREMENT_ADVANCES_ENABLED));
        },
      )
      .catch(() => {
        if (!isEdit) setEnabled(false);
      });
  }, [isEdit]);

  if (!enabled && !isEdit) return null;

  // Legacy peer-allowlist warning only when TEST ramp is not open.
  const peerMissing =
    proposalAccess != null &&
    proposalAccess.testRampOpen !== true &&
    proposalAccess.peerPresent !== false &&
    proposalAccess.selfAllowed === true &&
    proposalAccess.peerAllowed === false;

  const peerHandle = otherUsername
    ? `@${otherUsername.replace(/^@/, "")}`
    : otherDisplayName || "the other participant";
  const selectedBuyerId =
    buyerIsMe === true ? myId : buyerIsMe === false ? otherUserId || "" : "";
  const selectedSellerId =
    buyerIsMe === true ? otherUserId || "" : buyerIsMe === false ? myId : "";
  const buyerHandle =
    buyerIsMe === true ? "You" : buyerIsMe === false ? peerHandle : "—";
  const sourcerHandle =
    buyerIsMe === true ? peerHandle : buyerIsMe === false ? "You" : "—";

  async function submitProposal() {
    const proposalTraceId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `pt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    setBusy(true);
    setError("");

    const item = Math.round(Number(itemMajor) * 100);
    const shipping = Math.round(Number(shippingMajor || "0") * 100);
    const service = Math.round(Number(serviceMajor || "0") * 100);
    if (!Number.isFinite(item) || item <= 0) {
      setError(`Enter a valid item cost. Ref: ${proposalTraceId}`);
      setBusy(false);
      return;
    }
    if (!convId) {
      setError(`Missing conversation. Ref: ${proposalTraceId}`);
      setBusy(false);
      return;
    }
    // Pre-flight: still call the API (authoritative), but surface both-party gate early.
    if (peerMissing) {
      setError(
        `Your chat partner cannot use TEST payments yet. Ref: ${proposalTraceId}`,
      );
      setBusy(false);
      return;
    }
    if (atActiveLimit) {
      setError(
        `3 active Payment Tickets maximum. Complete or cancel one before creating another. Ref: ${proposalTraceId}`,
      );
      setBusy(false);
      return;
    }
    if (!otherUserId || otherUserId === myId) {
      setError(`This conversation needs two participants. Ref: ${proposalTraceId}`);
      setBusy(false);
      return;
    }
    if (buyerIsMe == null || !selectedBuyerId || !selectedSellerId) {
      setError(`Select who is buying. Ref: ${proposalTraceId}`);
      setBusy(false);
      return;
    }
    if (selectedBuyerId === selectedSellerId) {
      setError(`Buyer and sourcer must be different people. Ref: ${proposalTraceId}`);
      setBusy(false);
      return;
    }

    try {
      const res = await fetch("/api/payments/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proposal-trace-id": proposalTraceId,
        },
        cache: "no-store",
        body: JSON.stringify({
          conversationId: convId,
          itemCostMinor: item,
          shippingMinor: Number.isFinite(shipping) ? Math.max(0, shipping) : 0,
          sellerServiceFeeMinor: Number.isFinite(service)
            ? Math.max(0, service)
            : 0,
          title: title || undefined,
          currency: currency || "GBP",
          paymentOption: "PROTECTED",
          procurementAdvanceAgreed: procurementFlag ? procurement : false,
          proposalTraceId,
          buyerId: selectedBuyerId,
          sellerId: selectedSellerId,
          ...(editFromTicket?.reviseFromTicketId
            ? { reviseFromTicketId: editFromTicket.reviseFromTicketId }
            : {}),
        }),
      });

      let json: {
        ok?: boolean;
        error?: string;
        code?: string;
        allowlistParty?: string;
        proposalTraceId?: string;
        ticket?: PaymentTicketView;
        message?: ProposedTicketTimelineMessage | null;
      } = {};
      const rawText = await res.text();
      if (rawText) {
        try {
          json = JSON.parse(rawText) as typeof json;
        } catch {
          setError(
            `Server returned non-JSON (${res.status}). Ref: ${proposalTraceId}`,
          );
          console.info("[payments:propose]", {
            proposalTraceId,
            conversationId: convId,
            status: res.status,
            ticketId: null,
            parseError: true,
          });
          return;
        }
      } else if (!res.ok) {
        setError(
          `Empty error response (${res.status}). Ref: ${proposalTraceId}`,
        );
        console.info("[payments:propose]", {
          proposalTraceId,
          conversationId: convId,
          status: res.status,
          ticketId: null,
        });
        return;
      }

      const ticketId = json.ticket?.id;
      const ticketConv = json.ticket?.conversationId;
      const ref = json.proposalTraceId || proposalTraceId;

      console.info("[payments:propose]", {
        proposalTraceId: ref,
        conversationId: convId,
        status: res.status,
        ticketId: ticketId ?? null,
        revise: isEdit,
      });

      // Close modal ONLY after confirmed 2xx + ticket matching this conversation.
      const confirmed =
        res.ok &&
        res.status >= 200 &&
        res.status < 300 &&
        Boolean(json.ok) &&
        Boolean(ticketId) &&
        (ticketConv == null || ticketConv === convId);

      if (!confirmed) {
        const serverMsg = (json.error || "").trim();
        const party = (json.allowlistParty || "").trim();
        if (res.status === 403) {
          if (
            json.code === "PAYMENTS_ALLOWLIST_DENIED" ||
            /allowlist/i.test(serverMsg)
          ) {
            setError(
              `${
                serverMsg ||
                (party
                  ? `Payments test access denied — ${party} is not on the allowlist.`
                  : "Payments test access denied. Both parties must be on the payments test allowlist before proposing.")
              } Ref: ${ref}`,
            );
          } else {
            setError(
              `${
                serverMsg ||
                "Payments test access denied (allowlist). You cannot propose a ticket for this pair."
              } Ref: ${ref}`,
            );
          }
        } else if (res.status === 503) {
          setError(
            `${
              serverMsg ||
              "Protected Payments are not enabled right now. Try again later."
            } Ref: ${ref}`,
          );
        } else if (json.code === "ACTIVE_TICKET_LIMIT" || res.status === 409) {
          setError(
            `${
              serverMsg ||
              (json.code === "ACTIVE_TICKET_LIMIT"
                ? "3 active tickets maximum"
                : "Could not create Payment Ticket")
            } Ref: ${ref}`,
          );
        } else {
          setError(
            `${serverMsg || "Could not create Payment Ticket"} Ref: ${ref}`,
          );
        }
        // Form STAYS open — never setOpen(false) on failure.
        return;
      }

      if (!ticketId || !json.ticket) {
        setError(`Ticket created but missing id. Ref: ${ref}`);
        return;
      }

      setOpen(false);
      if (!isEdit) {
        setItemMajor("");
        setShippingMajor("0");
        setServiceMajor("0");
        setTitle("");
        setProcurement(false);
      }
      onCloseEdit?.();
      onCreated?.({
        ticket: json.ticket,
        // message may be null; parent synthesizes a timeline row from ticket.
        message: json.message ?? null,
      });
    } catch (err) {
      const msg =
        err instanceof Error && /json|parse/i.test(err.message)
          ? `Could not parse server response. Ref: ${proposalTraceId}`
          : `Could not create Payment Ticket — network or server error. Ref: ${proposalTraceId}`;
      setError(msg);
      console.info("[payments:propose]", {
        proposalTraceId,
        conversationId: convId,
        status: "throw",
        ticketId: null,
        error: err instanceof Error ? err.message : "unknown",
      });
    } finally {
      setBusy(false);
    }
  }

  /** Guard: if somehow wired to a real form, never bubble to parent compose. */
  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    void submitProposal();
  }

  function closeForm() {
    setOpen(false);
    onCloseEdit?.();
  }

  const formFields = (
    <>
      {isEdit ? (
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-electric">
          Revised Terms
        </p>
      ) : null}
      <p className={isEdit ? "mt-1 text-[10px] uppercase tracking-[0.12em] text-amber-200/70" : "text-[10px] uppercase tracking-[0.12em] text-amber-200/70"}>
        TEST PAYMENT · Sandbox — no real money
      </p>
      <p className="mt-1 text-[11px] text-white/45">
        {isEdit
          ? "This creates a new revision. Prior acceptance is invalidated — the other participant must accept again. Buyer and Sourcer are part of the agreement."
          : "Choose who is buying. You approve your proposal; the other person must Accept before payment."}
      </p>
      {isEdit ? (
        <p className="mt-2 text-[11px] text-amber-300/90">
          Warning: proposing revised terms supersedes the current ticket
          and requires re-acceptance before funding.
        </p>
      ) : null}
      {peerMissing ? (
        <p className="mt-2 text-[11px] text-amber-300">
          Your partner cannot use TEST payments yet. Propose may fail until
          both accounts are eligible.
        </p>
      ) : null}
      <label className="mt-3 block min-w-0 text-[11px] text-white/55">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full min-w-0 max-w-full rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-sm text-white"
          placeholder="Optional"
          disabled={busy}
        />
      </label>
      <fieldset className="mt-3 min-w-0">
        <legend className="text-[11px] font-medium text-white/70">
          Who is buying?
        </legend>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-white/15 px-2.5 py-2 text-sm text-white/85 hover:border-electric/40">
            <input
              type="radio"
              name={`ticket-buyer-${convId}`}
              className="h-4 w-4 accent-electric"
              checked={buyerIsMe === true}
              onChange={() => setBuyerIsMe(true)}
              disabled={busy}
            />
            <span>Me</span>
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-white/15 px-2.5 py-2 text-sm text-white/85 hover:border-electric/40">
            <input
              type="radio"
              name={`ticket-buyer-${convId}`}
              className="h-4 w-4 accent-electric"
              checked={buyerIsMe === false}
              onChange={() => setBuyerIsMe(false)}
              disabled={busy || !otherUserId}
            />
            <span className="min-w-0 truncate">{peerHandle}</span>
          </label>
        </div>
      </fieldset>
      {buyerIsMe != null ? (
        <div className="mt-2 min-w-0 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[11px] text-white/60">
          <p>
            Buyer:{" "}
            <span className="font-medium text-white/85">{buyerHandle}</span>
          </p>
          <p className="mt-0.5">
            Sourcer:{" "}
            <span className="font-medium text-white/85">{sourcerHandle}</span>
          </p>
        </div>
      ) : null}
      <label className="mt-2 block min-w-0 text-[11px] text-white/55">
        Currency
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="mt-1 w-full min-w-0 max-w-full rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-sm text-white"
          disabled={busy}
        >
          <option value="GBP">GBP (£)</option>
          <option value="USD">USD ($)</option>
        </select>
      </label>
      <label className="mt-2 block min-w-0 text-[11px] text-white/55">
        Item cost
        <input
          value={itemMajor}
          onChange={(e) => setItemMajor(e.target.value)}
          inputMode="decimal"
          required
          className="mt-1 w-full min-w-0 max-w-full rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-sm text-white"
          placeholder="5.00"
          disabled={busy}
        />
      </label>
      <label className="mt-2 block min-w-0 text-[11px] text-white/55">
        Shipping
        <input
          value={shippingMajor}
          onChange={(e) => setShippingMajor(e.target.value)}
          inputMode="decimal"
          className="mt-1 w-full min-w-0 max-w-full rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-sm text-white"
          placeholder="1.00"
          disabled={busy}
        />
      </label>
      <label className="mt-2 block min-w-0 text-[11px] text-white/55">
        Sourcer fee
        <input
          value={serviceMajor}
          onChange={(e) => setServiceMajor(e.target.value)}
          inputMode="decimal"
          className="mt-1 w-full min-w-0 max-w-full rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-sm text-white"
          placeholder="1.00"
          disabled={busy}
        />
      </label>
      {procurementFlag || isEdit ? (
        <label className="mt-3 flex min-w-0 items-start gap-2 text-[11px] text-white/60">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={procurement}
            onChange={(e) => setProcurement(e.target.checked)}
            disabled={busy || (!procurementFlag && isEdit)}
          />
          <span>
            Request procurement advance (item cost only). Allow
            buyer-authorized item-fund release after funding — never
            shipping.
            {!procurementFlag && isEdit
              ? " (Procurement advances currently disabled.)"
              : ""}
          </span>
        </label>
      ) : null}
      {error ? <p className="mt-2 text-[11px] text-amber-300">{error}</p> : null}
    </>
  );

  const formActions = (
    <div className="flex min-w-0 flex-wrap justify-end gap-2">
      <button
        type="button"
        onClick={closeForm}
        disabled={busy}
        data-testid="ticket-propose-cancel"
        className="min-h-11 rounded-md px-3 py-2 text-[11px] text-white/50"
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void submitProposal()}
        data-testid="ticket-propose-submit"
        className="inline-flex min-h-11 items-center gap-1 rounded-md bg-electric px-3 py-2 text-[11px] font-medium text-app-navy disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : null}
        {busy
          ? "Submitting..."
          : isEdit
            ? "Propose Revised Terms"
            : "Propose Agreement"}
      </button>
    </div>
  );

  return (
    <div className={isEdit ? "relative w-full" : "relative"}>
      {!hideTrigger && !isEdit ? (
        <button
          type="button"
          onClick={() => {
            if (atActiveLimit) return;
            setOpen((v) => !v);
          }}
          disabled={atActiveLimit}
          className={
            atActiveLimit
              ? "inline-flex max-w-[9.5rem] items-center gap-1 rounded-lg border border-white/15 px-2 py-1.5 text-[10px] font-medium text-white/35 sm:max-w-none sm:gap-1.5 sm:px-2.5 sm:text-[11px]"
              : "inline-flex items-center gap-1 rounded-lg border border-electric/40 px-2 py-1.5 text-[10px] font-medium text-electric hover:bg-electric/10 sm:gap-1.5 sm:px-2.5 sm:text-[11px]"
          }
          title={
            atActiveLimit
              ? "3 active Payment Tickets maximum. Complete or cancel one before creating another."
              : "Propose Protected Payment Ticket"
          }
          data-sb-build={BUILD_FINGERPRINT}
        >
          <ShieldCheck size={14} />
          <span className="truncate">
            {atActiveLimit ? "3 active max" : "Payment Ticket"}
          </span>
        </button>
      ) : null}
      {atActiveLimit && !isEdit && !hideTrigger ? (
        <p className="mt-1 max-w-[11rem] text-right text-[10px] leading-snug text-white/40 sm:max-w-none">
          3 active Payment Tickets maximum. Complete or cancel one before
          creating another.
        </p>
      ) : null}
      {open && isEdit ? (
        <div
          role="group"
          aria-label="Propose Revised Payment Terms"
          className="w-full min-w-0 max-w-full rounded-xl border border-electric/30 bg-[#061228] p-3"
          data-sb-ticket-form="inline-revise"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
              e.preventDefault();
              e.stopPropagation();
              if (!busy) void submitProposal();
            }
          }}
        >
          {formFields}
          <div className="mt-3">{formActions}</div>
          <form className="hidden" onSubmit={onFormSubmit} aria-hidden>
            <button type="submit" tabIndex={-1} />
          </form>
          <p className="sr-only">{myId}</p>
        </div>
      ) : null}
      {open && !isEdit && !atActiveLimit && mounted
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-end justify-center bg-black/65 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] md:items-center md:p-4"
              data-sb-ticket-form="viewport-dialog"
              onClick={(e) => {
                if (e.target === e.currentTarget && !busy) closeForm();
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Propose Payment Ticket"
                className="flex max-h-[min(100dvh,100%)] w-full min-w-0 max-w-md flex-col overflow-hidden rounded-xl border border-white/15 bg-[#061228] shadow-xl md:max-h-[min(85dvh,40rem)]"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!busy) void submitProposal();
                  }
                }}
              >
                <div className="flex shrink-0 items-start justify-between gap-2 border-b border-white/10 px-3 py-2.5">
                  <p className="min-w-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-electric">
                    Protected Payment
                  </p>
                  <button
                    type="button"
                    onClick={closeForm}
                    disabled={busy}
                    className="rounded-md p-1 text-white/50 hover:text-white"
                    aria-label="Close Payment Ticket form"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3">
                  {formFields}
                </div>
                <div className="shrink-0 border-t border-white/10 px-3 py-2.5">
                  {formActions}
                </div>
                <form className="hidden" onSubmit={onFormSubmit} aria-hidden>
                  <button type="submit" tabIndex={-1} />
                </form>
                <p className="sr-only">{myId}</p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
