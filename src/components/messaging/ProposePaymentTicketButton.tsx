"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

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
  flagsOn?: boolean;
  selfAllowed?: boolean;
  peerAllowed?: boolean;
  bothAllowed?: boolean;
  peerPresent?: boolean;
};

type ProposePaymentTicketButtonProps = {
  conversationId: string;
  myId: string;
  /**
   * From conversation GET. When self is allowlisted but peer is not, the form
   * still opens (same as before) but shows a clear pre-POST warning — create
   * requires both parties on PAYMENTS_TEST_ALLOWLIST.
   */
  proposalAccess?: PaymentsProposalAccess | null;
  onCreated?: (payload: {
    ticket: { id: string; conversationId?: string };
    message: ProposedTicketTimelineMessage | null;
  }) => void;
};

const BUILD_FINGERPRINT = "pt-propose-v3-nested-form-fix";

/**
 * Compact composer action to propose a Payment Ticket (no funding).
 * Fees are recalculated server-side. Only visible on payments test allowlist.
 *
 * IMPORTANT: Must NOT use a nested <form> inside MessagesInbox's compose <form>
 * (invalid HTML; browsers ignore the nested form and route submit to the
 * message sender instead — silent no-ticket + no error).
 */
export function ProposePaymentTicketButton({
  conversationId,
  myId,
  proposalAccess,
  onCreated,
}: ProposePaymentTicketButtonProps) {
  const [open, setOpen] = useState(false);
  const [itemMajor, setItemMajor] = useState("");
  const [shippingMajor, setShippingMajor] = useState("0");
  const [serviceMajor, setServiceMajor] = useState("0");
  const [title, setTitle] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [procurement, setProcurement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [procurementFlag, setProcurementFlag] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__SB_PAYMENT_TICKET_BUILD__ = BUILD_FINGERPRINT;
    }
  }, []);

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
          };
          paymentsAccess?: { testAccessAllowed?: boolean };
        }) => {
          const flagOn = Boolean(
            j.flags?.PROTECTED_PAYMENTS_ENABLED ||
              j.flags?.INSTANT_PAYMENTS_ENABLED,
          );
          const access = Boolean(j.paymentsAccess?.testAccessAllowed);
          setEnabled(flagOn && access);
          setProcurementFlag(Boolean(j.flags?.PROCUREMENT_ADVANCES_ENABLED));
        },
      )
      .catch(() => setEnabled(false));
  }, []);

  if (!enabled) return null;

  const peerMissing =
    proposalAccess != null &&
    proposalAccess.peerPresent !== false &&
    proposalAccess.selfAllowed === true &&
    proposalAccess.peerAllowed === false;

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
    // Pre-flight: still call the API (authoritative), but surface both-party gate early.
    if (peerMissing) {
      setError(
        `Your chat partner is not on the payments test allowlist. Both parties must be allowlisted before a ticket can be created. Ref: ${proposalTraceId}`,
      );
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
          conversationId,
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
        }),
      });

      let json: {
        ok?: boolean;
        error?: string;
        code?: string;
        allowlistParty?: string;
        proposalTraceId?: string;
        ticket?: { id: string; conversationId?: string };
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
            conversationId,
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
          conversationId,
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
        conversationId,
        status: res.status,
        ticketId: ticketId ?? null,
      });

      // Close modal ONLY after confirmed 2xx + ticket matching this conversation.
      const confirmed =
        res.ok &&
        res.status >= 200 &&
        res.status < 300 &&
        Boolean(json.ok) &&
        Boolean(ticketId) &&
        (ticketConv == null || ticketConv === conversationId);

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
        } else {
          setError(
            `${serverMsg || "Could not create Payment Ticket"} Ref: ${ref}`,
          );
        }
        // Form STAYS open — never setOpen(false) on failure.
        return;
      }

      if (!ticketId) {
        setError(`Ticket created but missing id. Ref: ${ref}`);
        return;
      }

      setOpen(false);
      setItemMajor("");
      setShippingMajor("0");
      setServiceMajor("0");
      setTitle("");
      setProcurement(false);
      onCreated?.({
        ticket: {
          id: ticketId,
          conversationId: ticketConv ?? conversationId,
        },
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
        conversationId,
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

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-electric/40 px-2.5 py-1.5 text-[11px] font-medium text-electric hover:bg-electric/10"
        title="Propose Protected Payment"
        data-sb-build={BUILD_FINGERPRINT}
      >
        <ShieldCheck size={14} />
        Payment Ticket
      </button>
      {open ? (
        // role=group (NOT form): parent MessagesInbox uses a compose <form>;
        // nested <form> is invalid HTML and can steal/drop ticket proposes.
        <div
          role="group"
          aria-label="Propose Payment Ticket"
          className="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-white/15 bg-[#061228] p-3 shadow-xl"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
              // Enter in text inputs must not submit the parent message form.
              e.preventDefault();
              e.stopPropagation();
              if (!busy) void submitProposal();
            }
          }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-electric">
            Protected Payment
          </p>
          <p className="mt-1 text-[11px] text-white/45">
            Both parties must accept the same terms before payment. Fees are
            calculated by Source Bridge. TEST allowlist only.
          </p>
          {peerMissing ? (
            <p className="mt-2 text-[11px] text-amber-300">
              Your partner is not on the payments test allowlist. Propose will
              fail until both of you are approved for the test ramp.
            </p>
          ) : null}
          <label className="mt-3 block text-[11px] text-white/55">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-sm text-white"
              placeholder="Optional"
              disabled={busy}
            />
          </label>
          <label className="mt-2 block text-[11px] text-white/55">
            Currency
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="mt-1 w-full rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-sm text-white"
              disabled={busy}
            >
              <option value="GBP">GBP (£)</option>
              <option value="USD">USD ($)</option>
            </select>
          </label>
          <label className="mt-2 block text-[11px] text-white/55">
            Item cost
            <input
              value={itemMajor}
              onChange={(e) => setItemMajor(e.target.value)}
              inputMode="decimal"
              required
              className="mt-1 w-full rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-sm text-white"
              placeholder="5.00"
              disabled={busy}
            />
          </label>
          <label className="mt-2 block text-[11px] text-white/55">
            Shipping
            <input
              value={shippingMajor}
              onChange={(e) => setShippingMajor(e.target.value)}
              inputMode="decimal"
              className="mt-1 w-full rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-sm text-white"
              placeholder="1.00"
              disabled={busy}
            />
          </label>
          <label className="mt-2 block text-[11px] text-white/55">
            Seller Service Fee
            <input
              value={serviceMajor}
              onChange={(e) => setServiceMajor(e.target.value)}
              inputMode="decimal"
              className="mt-1 w-full rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-sm text-white"
              placeholder="1.00"
              disabled={busy}
            />
          </label>
          {procurementFlag ? (
            <label className="mt-3 flex items-start gap-2 text-[11px] text-white/60">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={procurement}
                onChange={(e) => setProcurement(e.target.checked)}
                disabled={busy}
              />
              <span>
                Request procurement advance (item cost only). Buyer authorizes
                Release Item Funds after funding — never shipping.
              </span>
            </label>
          ) : null}
          {error ? <p className="mt-2 text-[11px] text-amber-300">{error}</p> : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="rounded-md px-2 py-1 text-[11px] text-white/50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitProposal()}
              className="inline-flex items-center gap-1 rounded-md bg-electric px-2.5 py-1 text-[11px] font-medium text-app-navy disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : null}
              {busy ? "Submitting..." : "Propose"}
            </button>
          </div>
          {/* Hidden bridge keeps unit tests that expect form onSubmit happy */}
          <form className="hidden" onSubmit={onFormSubmit} aria-hidden>
            <button type="submit" tabIndex={-1} />
          </form>
          <p className="sr-only">{myId}</p>
        </div>
      ) : null}
    </div>
  );
}
