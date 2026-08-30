"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  emitPurchaseOrderChanged,
  subscribePurchaseOrderChanged,
} from "@/lib/purchase-order-surface-sync";
import { shouldApplyOrdersPayload } from "@/lib/payments/purchase-display-state";

const ORDERS_SOFT_POLL_MS = 2500;

export type ProtectedOrderSummary = {
  id: string;
  status: string;
  displayState?: {
    phase: string;
    label: string;
    shortLabel: string;
  };
  updatedAt?: string | null;
  [key: string]: unknown;
};

type UseProtectedOrdersOpts = {
  role: "buyer" | "seller";
  enabled?: boolean;
};

export function useProtectedOrders(opts: UseProtectedOrdersOpts) {
  const { role, enabled = true } = opts;
  const [orders, setOrders] = useState<ProtectedOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const ordersVersionRef = useRef(0);
  const requestSeqRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyOrderPatch = useCallback((order: ProtectedOrderSummary) => {
    if (!order?.id) return;
    setOrders((prev) => {
      const idx = prev.findIndex((o) => o.id === order.id);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ...order };
      return next;
    });
  }, []);

  const load = useCallback(
    async (opts2?: { force?: boolean; silent?: boolean }) => {
      if (!enabled) return;
      const seq = ++requestSeqRef.current;
      if (!opts2?.silent) setLoading(true);
      setError("");
      try {
        const since =
          !opts2?.force && ordersVersionRef.current > 0
            ? `&sinceVersion=${ordersVersionRef.current}`
            : "";
        const res = await fetch(
          `/api/payments/orders?role=${role}${since}`,
          { cache: "no-store" },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load orders");
        if (data.unchanged) return;
        const incomingVersion =
          typeof data.ordersVersion === "number" ? data.ordersVersion : 0;
        if (
          !shouldApplyOrdersPayload({
            requestSeq: seq,
            latestSeq: requestSeqRef.current,
            incomingVersion,
            appliedVersion: ordersVersionRef.current,
          })
        ) {
          return;
        }
        ordersVersionRef.current = incomingVersion;
        setOrders((data.orders || []) as ProtectedOrderSummary[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!opts2?.silent) setLoading(false);
      }
    },
    [enabled, role],
  );

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) return;
    return subscribePurchaseOrderChanged((payload) => {
      if (payload.order && typeof payload.order === "object") {
        applyOrderPatch(payload.order as ProtectedOrderSummary);
      }
      if (typeof payload.ordersVersion === "number") {
        ordersVersionRef.current = Math.max(
          ordersVersionRef.current,
          payload.ordersVersion,
        );
      }
      void load({ silent: true });
    });
  }, [applyOrderPatch, enabled, load]);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;

    function startPoll() {
      if (pollTimerRef.current) return;
      pollTimerRef.current = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        void load({ silent: true });
      }, ORDERS_SOFT_POLL_MS);
    }

    function stopPoll() {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        void load({ silent: true });
        startPoll();
      } else {
        stopPoll();
      }
    }

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopPoll();
    };
  }, [enabled, load]);

  const publishOrderUpdate = useCallback(
    (order: ProtectedOrderSummary, ordersVersion?: number) => {
      applyOrderPatch(order);
      if (typeof ordersVersion === "number") {
        ordersVersionRef.current = Math.max(
          ordersVersionRef.current,
          ordersVersion,
        );
      }
      emitPurchaseOrderChanged({
        protectedTxnId: order.id,
        order,
        ordersVersion: ordersVersion ?? ordersVersionRef.current,
        version: ordersVersion ?? Date.now(),
      });
    },
    [applyOrderPatch],
  );

  return {
    orders,
    loading,
    error,
    reload: () => load({ force: true }),
    publishOrderUpdate,
  };
}
