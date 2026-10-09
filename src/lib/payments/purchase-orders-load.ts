/**
 * Client reducer for GET /api/payments/orders.
 * A missing, failed, or unchanged body must not be treated as an empty purchase list.
 */

import { shouldApplyOrdersPayload } from "@/lib/payments/purchase-display-state";

export type OrdersListRow = { id?: string; [key: string]: unknown };

export type OrdersListClientState = {
  orders: OrdersListRow[];
  error: string;
  hasAppliedOrders: boolean;
  ordersVersion: number;
  /** `buyer:<accountId>` or `seller:<accountId>`. Empty while signed out. */
  scope: string;
};

export function emptyOrdersListClientState(): OrdersListClientState {
  return {
    orders: [],
    error: "",
    hasAppliedOrders: false,
    ordersVersion: 0,
    scope: "",
  };
}

export function ordersListScope(
  role: "buyer" | "seller",
  accountId: string | null | undefined,
): string {
  return `${role}:${accountId ?? ""}`;
}

/** Full list until one valid orders array has been stored for this scope. */
export function ordersListSinceQuery(
  state: OrdersListClientState,
  force?: boolean,
): string {
  if (force || !state.hasAppliedOrders || !(state.ordersVersion > 0)) return "";
  return `&sinceVersion=${state.ordersVersion}`;
}

export type ParsedOrdersList =
  | { kind: "unchanged"; ordersVersion: number }
  | { kind: "orders"; orders: OrdersListRow[]; ordersVersion: number }
  | { kind: "invalid"; message: string };

export function parseOrdersListBody(
  body: unknown,
  httpOk: boolean,
  httpMessage?: string,
): ParsedOrdersList {
  if (!httpOk) {
    const message = String(httpMessage || "").trim() || "Failed to load orders";
    return { kind: "invalid", message };
  }
  if (!body || typeof body !== "object") {
    return { kind: "invalid", message: "Failed to load orders" };
  }
  const rec = body as Record<string, unknown>;
  if (rec.unchanged === true) {
    return {
      kind: "unchanged",
      ordersVersion: typeof rec.ordersVersion === "number" ? rec.ordersVersion : 0,
    };
  }
  if (!Array.isArray(rec.orders)) {
    return { kind: "invalid", message: "Failed to load orders" };
  }
  return {
    kind: "orders",
    orders: rec.orders as OrdersListRow[],
    ordersVersion: typeof rec.ordersVersion === "number" ? rec.ordersVersion : 0,
  };
}

export function reduceOrdersList(
  state: OrdersListClientState,
  opts: {
    seq: number;
    latestSeq: number;
    force?: boolean;
    /** Account and role that issued this request. Defaults to the list already on screen. */
    scope?: string;
    parsed: ParsedOrdersList;
  },
): { state: OrdersListClientState; followUp: "force" | null } {
  const requestScope = opts.scope ?? state.scope;
  if (requestScope !== state.scope) return { state, followUp: null };
  const { parsed } = opts;
  if (parsed.kind === "invalid") {
    if (opts.seq < opts.latestSeq) return { state, followUp: null };
    if (state.orders.length > 0) return { state, followUp: null };
    if (state.error === parsed.message) return { state, followUp: null };
    return { state: { ...state, error: parsed.message }, followUp: null };
  }
  if (parsed.kind === "unchanged") {
    if (!state.hasAppliedOrders && opts.seq === opts.latestSeq) {
      if (!opts.force) return { state, followUp: "force" };
      return {
        state: { ...state, error: "Failed to load orders" },
        followUp: null,
      };
    }
    return { state, followUp: null };
  }
  const apply = shouldApplyOrdersPayload({
    requestSeq: opts.seq,
    latestSeq: opts.latestSeq,
    incomingVersion: parsed.ordersVersion,
    appliedVersion: state.ordersVersion,
    hasAppliedOrders: state.hasAppliedOrders,
    force: opts.force,
    incomingCount: parsed.orders.length,
    visibleCount: state.orders.length,
  });
  if (!apply) return { state, followUp: null };
  return {
    state: {
      orders: parsed.orders,
      error: "",
      hasAppliedOrders: true,
      ordersVersion: parsed.ordersVersion,
      scope: state.scope,
    },
    followUp: null,
  };
}

/** What the purchases page should render. A failed load is never the empty copy. */
export function purchasesPanelState(opts: {
  loading: boolean;
  error: string;
  count: number;
}): "loading" | "error" | "empty" | "list" {
  if (opts.count > 0) return "list";
  if (opts.loading) return "loading";
  if (opts.error.trim()) return "error";
  return "empty";
}
