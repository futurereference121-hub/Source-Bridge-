"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { OpportunityPublic } from "@/lib/opportunities/map";
import { OpportunityTicket } from "@/components/opportunities/OpportunityTicket";
import { OpportunityDetailSheet } from "@/components/opportunities/OpportunityDetailSheet";
import { OpportunityCreateWizard } from "@/components/opportunities/OpportunityCreateWizard";
import { Container } from "@/components/ui/Container";
import { useAppUi } from "@/components/providers/AppProviders";
import { CREATABLE_OPPORTUNITY_KINDS } from "@/lib/opportunities/kinds";
import { opportunityAuthReturnPath } from "@/lib/opportunities/public-teaser";

type Mode = "for_you" | "latest";

export function OpportunitiesMarketplaceClient() {
  const searchParams = useSearchParams();
  const { account, requireAuth, authReady } = useAppUi();
  const [mode, setMode] = useState<Mode>("for_you");
  const [items, setItems] = useState<OpportunityPublic[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OpportunityPublic | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [mine, setMine] = useState<OpportunityPublic[]>([]);
  const [showMine, setShowMine] = useState(searchParams.get("mine") === "1");

  const [filters, setFilters] = useState({
    kind: "ALL",
    country: "",
    city: "",
    category: "",
    deliveryCountry: "",
    openOnly: false,
  });
  const debounceRef = useRef<number | null>(null);
  const requestSeq = useRef(0);
  const feedScrollRef = useRef<HTMLDivElement>(null);

  const buildQuery = useCallback(
    (cursor?: string | null) => {
      const q = new URLSearchParams();
      q.set("mode", mode);
      q.set("limit", "20");
      if (cursor) q.set("cursor", cursor);
      if (filters.kind !== "ALL") q.set("kind", filters.kind);
      if (filters.country.trim()) q.set("country", filters.country.trim());
      if (filters.city.trim()) q.set("city", filters.city.trim());
      if (filters.category.trim()) q.set("category", filters.category.trim());
      if (filters.deliveryCountry.trim()) {
        q.set("deliveryCountry", filters.deliveryCountry.trim());
      }
      if (filters.openOnly) q.set("openOnly", "1");
      return q.toString();
    },
    [mode, filters],
  );

  const load = useCallback(
    async (opts: { append: boolean; cursor?: string | null }) => {
      const seq = ++requestSeq.current;
      if (opts.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/opportunities/marketplace?${buildQuery(opts.cursor)}`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (seq !== requestSeq.current) return;
        if (!res.ok) throw new Error(data.error || "Failed to load");
        const next = (data.items || []) as OpportunityPublic[];
        setItems((prev) =>
          opts.append
            ? [
                ...prev,
                ...next.filter((n) => !prev.some((p) => p.id === n.id)),
              ]
            : next,
        );
        setNextCursor(data.nextCursor || null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [buildQuery],
  );

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void load({ append: false });
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [load]);

  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) return;
    if (!authReady) return;
    if (!account) {
      const next = opportunityAuthReturnPath(
        id,
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "/opportunities",
      );
      requireAuth("view full Opportunity details and respond", next);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/opportunities/${id}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!cancelled && data.opportunity) {
          setSelected(data.opportunity);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, account, authReady, requireAuth]);

  async function loadMine() {
    if (!requireAuth("manage your opportunities")) return;
    setShowMine(true);
    const res = await fetch("/api/opportunities", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setMine(data.opportunities || []);
  }

  async function ownerAction(id: string, action: string) {
    const res = await fetch(`/api/opportunities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        clientRequestId:
          action === "renew"
            ? `renew_${id}_${Date.now().toString(36)}`
            : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Action failed");
    setSelected(data.opportunity);
    setMine((prev) =>
      prev.map((o) => (o.id === id ? data.opportunity : o)),
    );
    void load({ append: false });
  }

  function openTicket(id: string) {
    const next = opportunityAuthReturnPath(
      id,
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/opportunities",
    );
    if (
      !requireAuth("view full Opportunity details and respond", next)
    ) {
      return;
    }
    // List items are public summaries (no budget). Always fetch full detail.
    void fetch(`/api/opportunities/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.opportunity) setSelected(d.opportunity);
      });
  }

  const isOwner =
    Boolean(account?.id) &&
    Boolean(selected?.creator?.id) &&
    account?.id === selected?.creator?.id;

  return (
    <div className="bg-app-navy min-h-[100svh] pt-24 pb-24 text-white sm:pt-28 sm:pb-28">
      <Container>
        <header className="mx-auto max-w-3xl text-center">
          <h1 className="font-display text-[1.65rem] tracking-tight text-white sm:text-4xl">
            Opportunities
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-white/60 sm:text-base">
            Structured marketplace intents — buyer requests, sourcing offers,
            and travel windows. Not payments, Live, or Status.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!requireAuth("post an opportunity")) return;
                setCreateOpen(true);
              }}
              className="rounded-lg bg-electric px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-navy"
            >
              Post opportunity
            </button>
            <button
              type="button"
              onClick={() => void loadMine()}
              className="rounded-lg border border-white/20 px-4 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-white/80"
            >
              My opportunities
            </button>
            <Link
              href="/explore"
              className="rounded-lg border border-white/10 px-4 py-2.5 text-xs uppercase tracking-[0.14em] text-white/50"
            >
              Back to Explore
            </Link>
          </div>
        </header>

        <div className="mx-auto mt-8 flex max-w-3xl gap-2">
          {(
            [
              ["for_you", "For You"],
              ["latest", "Latest"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`flex-1 rounded-lg px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] ${
                mode === value
                  ? "bg-white/10 text-white"
                  : "text-white/45 hover:text-white/70"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mx-auto mt-4 grid max-w-3xl grid-cols-2 gap-2 sm:grid-cols-3">
          <select
            className="rounded-lg border border-white/15 bg-transparent px-2 py-2 text-xs text-white"
            value={filters.kind}
            onChange={(e) => setFilters({ ...filters, kind: e.target.value })}
            aria-label="Filter by type"
          >
            <option value="ALL">All types</option>
            {CREATABLE_OPPORTUNITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replaceAll("_", " ")}
              </option>
            ))}
            <option value="LEGACY_GENERAL">Legacy</option>
          </select>
          <input
            className="rounded-lg border border-white/15 bg-transparent px-2 py-2 text-xs text-white"
            placeholder="Country"
            value={filters.country}
            onChange={(e) =>
              setFilters({ ...filters, country: e.target.value })
            }
            aria-label="Filter by country"
          />
          <input
            className="rounded-lg border border-white/15 bg-transparent px-2 py-2 text-xs text-white"
            placeholder="City"
            value={filters.city}
            onChange={(e) => setFilters({ ...filters, city: e.target.value })}
            aria-label="Filter by city"
          />
          <input
            className="rounded-lg border border-white/15 bg-transparent px-2 py-2 text-xs text-white"
            placeholder="Category"
            value={filters.category}
            onChange={(e) =>
              setFilters({ ...filters, category: e.target.value })
            }
            aria-label="Filter by category"
          />
          <input
            className="rounded-lg border border-white/15 bg-transparent px-2 py-2 text-xs text-white"
            placeholder="Delivery country"
            value={filters.deliveryCountry}
            onChange={(e) =>
              setFilters({ ...filters, deliveryCountry: e.target.value })
            }
            aria-label="Filter by delivery country"
          />
          <label className="flex items-center gap-2 rounded-lg border border-white/15 px-2 py-2 text-xs text-white/70">
            <input
              type="checkbox"
              checked={filters.openOnly}
              onChange={(e) =>
                setFilters({ ...filters, openOnly: e.target.checked })
              }
            />
            Open only
          </label>
        </div>
        <div className="mx-auto mt-2 flex max-w-3xl justify-end">
          <button
            type="button"
            className="text-[11px] uppercase tracking-wider text-white/40 hover:text-white/70"
            onClick={() =>
              setFilters({
                kind: "ALL",
                country: "",
                city: "",
                category: "",
                deliveryCountry: "",
                openOnly: false,
              })
            }
          >
            Clear filters
          </button>
        </div>

        {showMine ? (
          <section className="mx-auto mt-8 max-w-3xl">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
              My opportunities
            </h2>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {mine.map((o) => (
                <OpportunityTicket
                  key={o.id}
                  opportunity={o}
                  onOpen={openTicket}
                />
              ))}
            </div>
            {!mine.length ? (
              <p className="text-sm text-white/45">No opportunities yet.</p>
            ) : null}
          </section>
        ) : null}

        <div ref={feedScrollRef} className="mx-auto mt-8 max-w-3xl">
          {loading ? (
            <p className="text-sm text-white/45">Loading opportunities…</p>
          ) : null}
          {error ? (
            <p className="text-sm text-red-300" role="alert">
              {error}
            </p>
          ) : null}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {items.map((o) => (
              <OpportunityTicket key={o.id} opportunity={o} onOpen={openTicket} />
            ))}
          </div>
          {!loading && !items.length ? (
            <p className="mt-8 text-center text-sm text-white/45">
              No opportunities match these filters.
            </p>
          ) : null}
          {nextCursor ? (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() =>
                  void load({ append: true, cursor: nextCursor })
                }
                className="rounded-lg border border-white/20 px-5 py-2.5 text-xs uppercase tracking-[0.14em] text-white/80 disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </div>
      </Container>

      <OpportunityDetailSheet
        opportunity={selected}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        isOwner={isOwner}
        ownerActions={
          selected ? (
            <div className="flex flex-wrap gap-2">
              {selected.lifecycle === "OPEN" ||
              selected.lifecycle === "IN_DISCUSSION" ? (
                <>
                  <OwnerBtn
                    onClick={() =>
                      void ownerAction(selected.id, "mark_matched")
                    }
                  >
                    Mark matched
                  </OwnerBtn>
                  <OwnerBtn
                    onClick={() =>
                      void ownerAction(selected.id, "mark_fulfilled")
                    }
                  >
                    Mark fulfilled
                  </OwnerBtn>
                  <OwnerBtn
                    onClick={() => void ownerAction(selected.id, "withdraw")}
                  >
                    Withdraw
                  </OwnerBtn>
                </>
              ) : null}
              {selected.lifecycle === "EXPIRED" ||
              selected.lifecycle === "WITHDRAWN" ? (
                <OwnerBtn
                  onClick={() => void ownerAction(selected.id, "renew")}
                >
                  Renew opportunity
                </OwnerBtn>
              ) : null}
            </div>
          ) : null
        }
      />

      <OpportunityCreateWizard
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          void load({ append: false });
          if (showMine) void loadMine();
        }}
      />
    </div>
  );
}

function OwnerBtn({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-white/20 px-3 py-2 text-[11px] uppercase tracking-wider text-white/80 hover:border-electric/40"
    >
      {children}
    </button>
  );
}
