"use client";

import { useEffect, useRef, useState } from "react";
import type { OpportunityPublic } from "@/lib/opportunities/map";
import { OpportunityDetailSheet } from "@/components/opportunities/OpportunityDetailSheet";
import { useAppUi } from "@/components/providers/AppProviders";
import { opportunityAuthReturnPath } from "@/lib/opportunities/public-teaser";

type Props = {
  opportunityId: string | null;
  onClose: () => void;
  isOwner?: boolean;
  ownerActions?: React.ReactNode;
};

/**
 * Shared overlay host: fetch by id + OpportunityDetailSheet.
 * Full detail requires session; parents should requireAuth before setting id.
 */
export function OpportunityOverlay({
  opportunityId,
  onClose,
  isOwner,
  ownerActions,
}: Props) {
  const { account, requireAuth, authReady } = useAppUi();
  const [opportunity, setOpportunity] = useState<OpportunityPublic | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const promptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!opportunityId) {
      setOpportunity(null);
      setError(null);
      promptedRef.current = null;
      return;
    }
    if (!authReady) return;

    if (!account) {
      if (promptedRef.current !== opportunityId) {
        promptedRef.current = opportunityId;
        const next = opportunityAuthReturnPath(
          opportunityId,
          `${window.location.pathname}${window.location.search}`,
        );
        requireAuth("view full Opportunity details", next);
      }
      onCloseRef.current();
      return;
    }

    let cancelled = false;
    setError(null);
    setOpportunity(null);
    void (async () => {
      try {
        const res = await fetch(`/api/opportunities/${opportunityId}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 401) {
          const next = opportunityAuthReturnPath(
            opportunityId,
            `${window.location.pathname}${window.location.search}`,
          );
          requireAuth("view full Opportunity details", next);
          onCloseRef.current();
          return;
        }
        if (!res.ok) {
          setOpportunity(null);
          setError(data.error || "Could not load opportunity");
          return;
        }
        setOpportunity(data.opportunity as OpportunityPublic);
      } catch {
        if (!cancelled) {
          setOpportunity(null);
          setError("Could not load opportunity");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opportunityId, account, authReady, requireAuth]);

  if (!opportunityId || !account) return null;

  if (!opportunity && !error) {
    return (
      <div
        className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6"
        role="presentation"
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/65"
          aria-label="Close"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-busy="true"
          aria-label="Loading opportunity"
          className="relative z-[81] w-full max-w-lg rounded-t-2xl border border-white/12 bg-[#0b1220] px-4 py-8 text-center text-sm text-white/55 sm:rounded-2xl"
          style={{
            paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
          }}
        >
          Loading opportunity…
        </div>
      </div>
    );
  }

  if (error && !opportunity) {
    return (
      <div
        className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6"
        role="presentation"
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/65"
          aria-label="Close"
          onClick={onClose}
        />
        <div
          role="alertdialog"
          aria-modal="true"
          className="relative z-[81] w-full max-w-sm rounded-t-2xl border border-white/12 bg-[#0b1220] p-5 sm:rounded-2xl"
        >
          <p className="text-sm text-red-300">{error}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 w-full rounded-lg border border-white/20 py-2.5 text-xs uppercase tracking-wider text-white/80"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <OpportunityDetailSheet
      opportunity={opportunity}
      open={Boolean(opportunityId)}
      onClose={onClose}
      isOwner={isOwner}
      ownerActions={ownerActions}
    />
  );
}
