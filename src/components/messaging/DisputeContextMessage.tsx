"use client";

import { useState } from "react";
import Link from "next/link";
import {
  extractLegacyDisputeIds,
  formatDisputeDate,
  resolveDisputeContextDisplay,
  type DisputeContextStructured,
} from "@/lib/payments/dispute-context-copy";

type Props = {
  body: string;
  createdAt?: string | null;
  structured?: Partial<DisputeContextStructured> | null;
};

/**
 * Human dispute / review card. Raw IDs only under Advanced / Audit.
 */
export default function DisputeContextMessage({
  body,
  createdAt,
  structured,
}: Props) {
  const [auditOpen, setAuditOpen] = useState(false);
  const legacy = extractLegacyDisputeIds(body);
  const data = resolveDisputeContextDisplay(body, {
    ...structured,
    createdAtIso: structured?.createdAtIso || createdAt || undefined,
    disputeCaseId: structured?.disputeCaseId || legacy.disputeCaseId,
    protectedTxnId: structured?.protectedTxnId || legacy.protectedTxnId,
    paymentTicketId: structured?.paymentTicketId || legacy.paymentTicketId,
  });

  const hasAudit = Boolean(
    data.disputeCaseId || data.protectedTxnId || data.paymentTicketId,
  );

  return (
    <div
      className="space-y-2 text-sm text-white/90"
      data-testid="dispute-context-message"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-electric">
        SOURCE BRIDGE REVIEW
      </p>
      <p>
        <span className="text-white/45">Item:</span> {data.title}
      </p>
      <p>
        <span className="text-white/45">Issue:</span> {data.issueSummary}
      </p>
      <p>
        <span className="text-white/45">Status:</span> {data.statusLabel}
      </p>
      <p className="text-white/70">
        {data.buyerHandle} · {data.sellerHandle}
      </p>
      <p className="text-white/45">{formatDisputeDate(data.createdAtIso)}</p>
      {data.reviewHref && data.reviewHref !== "#" ? (
        <Link
          href={data.reviewHref}
          className="inline-flex text-[11px] font-semibold uppercase tracking-[0.12em] text-electric hover:text-electric-hover"
          data-testid="dispute-context-view-review"
        >
          View Review
        </Link>
      ) : (
        <span className="inline-flex text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
          View Review
        </span>
      )}
      {hasAudit ? (
        <div className="pt-1">
          <button
            type="button"
            className="text-[10px] uppercase tracking-[0.12em] text-white/35 hover:text-white/55"
            onClick={() => setAuditOpen((v) => !v)}
            data-testid="dispute-context-audit-toggle"
          >
            {auditOpen ? "Hide Advanced / Audit" : "Advanced / Audit"}
          </button>
          {auditOpen ? (
            <dl
              className="mt-2 space-y-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-[10px] text-white/45"
              data-testid="dispute-context-audit"
            >
              {data.disputeCaseId ? (
                <div>
                  <dt className="inline text-white/30">dispute </dt>
                  <dd className="inline break-all">{data.disputeCaseId}</dd>
                </div>
              ) : null}
              {data.protectedTxnId ? (
                <div>
                  <dt className="inline text-white/30">txn </dt>
                  <dd className="inline break-all">{data.protectedTxnId}</dd>
                </div>
              ) : null}
              {data.paymentTicketId ? (
                <div>
                  <dt className="inline text-white/30">ticket </dt>
                  <dd className="inline break-all">{data.paymentTicketId}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
