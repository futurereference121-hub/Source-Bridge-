"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  emitPurchaseOrderChanged,
  subscribePurchaseOrderChanged,
} from "@/lib/purchase-order-surface-sync";
import {
  emptyOrdersListClientState,
  ordersListScope,
  ordersListSinceQuery,
  parseOrdersListBody,
  reduceOrdersList,
  type OrdersListClientState,
} from "@/lib/payments/purchase-orders-load";

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
  /** Reloads when the signed-in account changes so one user's list cannot stick. */
  accountId?: string | null;
};

export function useProtectedOrders(opts: UseProtectedOrdersOpts) {
  const { role, enabled = true, accountId = null } = opts;
  const [orders, setOrders] = useState<ProtectedOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const stateRef = useRef<OrdersListClientState>(emptyOrdersListClientState());
  const requestSeqRef = useRef(0);
  const generationRef = useRef(0);
  const inflightRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scopeRef = useRef<string | null>(null);
  const accountIdRef = useRef(accountId);
  const roleRef = useRef(role);
  accountIdRef.current = accountId;
  roleRef.current = role;

  const commit = useCallback((next: OrdersListClientState) => {
    stateRef.current = next;
    setOrders(next.orders as ProtectedOrderSummary[]);
    setError(next.error);
  }, []);

  const applyOrderPatch = useCallback((order: ProtectedOrderSummary) => {
    if (!order?.id) return;
    const prev = stateRef.current;
    const idx = prev.orders.findIndex((o) => o.id === order.id);
    if (idx < 0) return;
    const nextOrders = [...prev.orders];
    nextOrders[idx] = { ...nextOrders[idx], ...order };
    commit({ ...prev, orders: nextOrders });
  }, [commit]);

  const load = useCallback(
    async (opts2?: { force?: boolean; silent?: boolean }) => {
      if (!enabled) return;
      const generation = generationRef.current;
      const requestScope = ordersListScope(roleRef.current, accountIdRef.current);
      const seq = ++requestSeqRef.current;
      inflightRef.current += 1;
      if (!opts2?.silent) setLoading(true);
      let followUp: "force" | null = null;
      try {
        const since = ordersListSinceQuery(stateRef.current, opts2?.force);
        const res = await fetch(`/api/payments/orders?role=${roleRef.current}${since}`, {
          cache: "no-store",
        });
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        if (generation !== generationRef.current) return;
        if (requestScope !== stateRef.current.scope) return;
        const httpMessage =
          body && typeof body === "object" && "error" in body
            ? String((body as { error?: unknown }).error || "")
            : "";
        const parsed = parseOrdersListBody(body, res.ok, httpMessage);
        const reduced = reduceOrdersList(stateRef.current, {
          seq,
          latestSeq: requestSeqRef.current,
          force: Boolean(opts2?.force),
          scope: requestScope,
          parsed,
        });
        if (reduced.state !== stateRef.current) commit(reduced.state);
        followUp = reduced.followUp;
      } catch (err) {
        if (generation !== generationRef.current) return;
        if (requestScope !== stateRef.current.scope) return;
        const reduced = reduceOrdersList(stateRef.current, {
          seq,
          latestSeq: requestSeqRef.current,
          scope: requestScope,
          parsed: {
            kind: "invalid",
            message: err instanceof Error ? err.message : "Failed to load",
          },
        });
        if (reduced.state !== stateRef.current) commit(reduced.state);
      } finally {
        if (generation === generationRef.current) {
          inflightRef.current = Math.max(0, inflightRef.current - 1);
          const waitingForFullList =
            followUp === "force" && seq === requestSeqRef.current;
          if (inflightRef.current === 0 && !waitingForFullList) setLoading(false);
        }
      }
      if (
        followUp === "force" &&
        generation === generationRef.current &&
        seq === requestSeqRef.current
      ) {
        void load({ force: true, silent: Boolean(opts2?.silent) });
      }
    },
    [commit, enabled],
  );

  useEffect(() => {
    if (!enabled) {
      if (scopeRef.current !== null || stateRef.current.scope !== "") {
        scopeRef.current = null;
        generationRef.current += 1;
        inflightRef.current = 0;
        commit(emptyOrdersListClientState());
        setLoading(false);
      }
      return;
    }
    const scope = ordersListScope(role, accountId);
    if (scopeRef.current !== scope || stateRef.current.scope !== scope) {
      scopeRef.current = scope;
      generationRef.current += 1;
      inflightRef.current = 0;
      commit({ ...emptyOrdersListClientState(), scope });
      setLoading(true);
      void load({ force: true });
      return;
    }
    void load();
  }, [accountId, commit, enabled, load, role]);

  useEffect(() => {
    if (!enabled) return;
    return subscribePurchaseOrderChanged((payload) => {
      if (payload.order && typeof payload.order === "object") {
        applyOrderPatch(payload.order as ProtectedOrderSummary);
      }
      if (
        typeof payload.ordersVersion === "number" &&
        stateRef.current.hasAppliedOrders
      ) {
        stateRef.current = {
          ...stateRef.current,
          ordersVersion: Math.max(
            stateRef.current.ordersVersion,
            payload.ordersVersion,
          ),
        };
      }
      void load({
        silent: true,
        force: !stateRef.current.hasAppliedOrders,
      });
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
      if (
        stateRef.current.hasAppliedOrders ||
        stateRef.current.orders.some((row) => row.id === order.id)
      ) {
        stateRef.current = {
          ...stateRef.current,
          hasAppliedOrders: true,
          ordersVersion:
            typeof ordersVersion === "number"
              ? Math.max(stateRef.current.ordersVersion, ordersVersion)
              : stateRef.current.ordersVersion,
        };
      }
      emitPurchaseOrderChanged({
        protectedTxnId: order.id,
        order,
        ordersVersion: ordersVersion ?? stateRef.current.ordersVersion,
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
