"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { ImageUploadField } from "@/components/profile/ImageUploadField";
import { uploadProfileImageFile } from "@/lib/client-image-upload";
import type { Listing } from "@/lib/types";
import { IMAGE_ACCEPT_ATTR } from "@/lib/storage-constants";

type Limit = { used: number; remaining: number; limit: number };
type OpportunityRow = {
  id: string; title: string; description: string; city: string; country: string;
  category: string; expiresAt?: string | null; active: boolean;
};
type NetworkRow = { id: string; city: string; country: string; sortOrder: number };
type TripRow = { id: string; city: string; country: string; arrival: string; departure: string };
type CategoryRow = { id: string; name: string };
type ProfileForm = {
  name: string; bio: string; city: string; country: string;
  publicDisplayMessage: string; photo: string; cover: string;
};

const blankProfile: ProfileForm = {
  name: "", bio: "", city: "", country: "", publicDisplayMessage: "", photo: "", cover: "",
};
const blankOpportunity = {
  title: "", description: "", city: "", country: "", category: "", expiresAt: "",
};
const blankPlace = { city: "", country: "" };
const blankTrip = { city: "", country: "", arrival: "", departure: "" };
const blankStock = {
  name: "", description: "", category: "", quantity: "", availability: "available",
  location: "", images: [] as string[],
};

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

export default function ProfileDashboardPage() {
  const router = useRouter();
  const { account, signedIn, authReady, showToast, signOut, refreshAccount } = useAppUi();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(blankProfile);
  const [counts, setCounts] = useState({ followers: 0, following: 0 });
  const [status, setStatus] = useState("");
  const [statusLimit, setStatusLimit] = useState<Limit | null>(null);
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [opportunityLimit, setOpportunityLimit] = useState<Limit | null>(null);
  const [oppForm, setOppForm] = useState(blankOpportunity);
  const [editingOpp, setEditingOpp] = useState<string | null>(null);
  const [network, setNetwork] = useState<NetworkRow[]>([]);
  const [networkForm, setNetworkForm] = useState(blankPlace);
  const [editingNetwork, setEditingNetwork] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [tripForm, setTripForm] = useState(blankTrip);
  const [editingTrip, setEditingTrip] = useState<string | null>(null);
  const [stock, setStock] = useState<Listing[]>([]);
  const [stockForm, setStockForm] = useState(blankStock);
  const [editingStock, setEditingStock] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!authReady) return;
    if (!signedIn || !account) { setLoading(false); return; }
    if (!account.emailVerified) { router.replace("/check-email"); return; }
    if (!account.onboardingComplete) { router.replace("/onboarding"); return; }
    Promise.all([
      api("/api/profile"), api("/api/status"), api("/api/opportunities"),
      api("/api/network"), api("/api/trips"), api("/api/stock"), api("/api/categories"),
    ]).then(([p, s, o, n, t, st, c]) => {
      const m = p.member;
      setProfile({
        name: m?.fullName || account.name, bio: m?.bio || "", city: m?.location?.city || "",
        country: m?.location?.country || "", publicDisplayMessage: m?.publicDisplayMessage || "",
        photo: m?.photo || "", cover: m?.cover || "",
      });
      setCounts(p.counts || { followers: 0, following: 0 });
      setStatus(s.status?.text || ""); setStatusLimit(s.limit);
      setOpportunities(o.opportunities || []); setOpportunityLimit(o.limit);
      setNetwork(n.network || []); setTrips(t.trips || []); setStock(st.listings || []);
      setCategories(c.categories || []);
    }).catch((e) => showToast(e.message)).finally(() => setLoading(false));
  }, [account, authReady, router, showToast, signedIn]);

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    try { await work(); } catch (e) { showToast(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(""); }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    await run("profile", async () => {
      await api("/api/profile", json("PATCH", profile));
      await refreshAccount(); showToast("Profile saved");
    });
  }

  async function onProfileImageUploaded(kind: "photo" | "cover", url: string) {
    setProfile((p) => ({ ...p, [kind]: url }));
    await api("/api/profile", json("PATCH", { [kind]: url }));
    if (kind === "photo") await refreshAccount();
  }

  async function uploadStockImages(files: FileList | null) {
    if (!files?.length || !account) return;
    await run("stock-images", async () => {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const result = await uploadProfileImageFile({
          file,
          folder: "stock",
          kind: "stock",
          userId: account.id,
        });
        if (result.previewUrl) URL.revokeObjectURL(result.previewUrl);
        urls.push(result.url);
      }
      setStockForm((f) => ({ ...f, images: [...f.images, ...urls].slice(0, 12) }));
      showToast("Images uploaded");
    });
  }

  async function publishStatus(e: FormEvent) {
    e.preventDefault();
    await run("status", async () => {
      const data = await api("/api/status", json("POST", { text: status }));
      setStatusLimit(data.limit); showToast("Status published");
    });
  }

  async function saveOpportunity(e: FormEvent) {
    e.preventDefault();
    await run("opportunity", async () => {
      const payload = {
        ...oppForm,
        expiresAt: oppForm.expiresAt ? new Date(`${oppForm.expiresAt}T23:59:59`).toISOString() : null,
      };
      if (editingOpp) await api(`/api/opportunities/${editingOpp}`, json("PATCH", payload));
      else await api("/api/opportunities", json("POST", payload));
      const data = await api("/api/opportunities");
      setOpportunities(data.opportunities || []); setOpportunityLimit(data.limit);
      setOppForm(blankOpportunity); setEditingOpp(null); showToast("Opportunity saved");
    });
  }

  function editOpportunity(o: OpportunityRow) {
    setEditingOpp(o.id);
    setOppForm({
      title: o.title, description: o.description, city: o.city, country: o.country,
      category: o.category, expiresAt: o.expiresAt?.slice(0, 10) || "",
    });
  }

  async function closeOpportunity(id: string) {
    await run(`opp-${id}`, async () => {
      await api(`/api/opportunities/${id}`, { method: "DELETE" });
      setOpportunities((rows) => rows.map((o) => o.id === id ? { ...o, active: false } : o));
      showToast("Opportunity closed");
    });
  }

  async function saveNetwork(e: FormEvent) {
    e.preventDefault();
    await run("network", async () => {
      const data = editingNetwork
        ? await api(`/api/network/${editingNetwork}`, json("PATCH", networkForm))
        : await api("/api/network", json("POST", networkForm));
      if (editingNetwork) setNetwork((rows) => rows.map((n) => n.id === editingNetwork ? data.location : n));
      else setNetwork((rows) => [...rows, data.location]);
      setNetworkForm(blankPlace); setEditingNetwork(null); showToast("Network updated");
    });
  }

  async function moveNetwork(index: number, direction: -1 | 1) {
    const next = [...network]; const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setNetwork(next);
    await run("reorder", async () => {
      await api("/api/network", json("PUT", { action: "reorder", orderedIds: next.map((n) => n.id) }));
    });
  }

  async function removeNetwork(id: string) {
    await run(`net-${id}`, async () => {
      await api(`/api/network/${id}`, { method: "DELETE" });
      setNetwork((rows) => rows.filter((n) => n.id !== id)); showToast("Location removed");
    });
  }

  async function saveTrip(e: FormEvent) {
    e.preventDefault();
    await run("trip", async () => {
      const data = editingTrip
        ? await api(`/api/trips/${editingTrip}`, json("PATCH", tripForm))
        : await api("/api/trips", json("POST", tripForm));
      if (editingTrip) setTrips((rows) => rows.map((t) => t.id === editingTrip ? data.trip : t));
      else setTrips((rows) => [...rows, data.trip]);
      setTripForm(blankTrip); setEditingTrip(null); showToast("Travel saved");
    });
  }

  async function removeTrip(id: string) {
    await run(`trip-${id}`, async () => {
      await api(`/api/trips/${id}`, { method: "DELETE" });
      setTrips((rows) => rows.filter((t) => t.id !== id)); showToast("Travel removed");
    });
  }

  async function saveStock(e: FormEvent) {
    e.preventDefault();
    await run("stock", async () => {
      const data = editingStock
        ? await api(`/api/stock/${editingStock}`, json("PATCH", stockForm))
        : await api("/api/stock", json("POST", stockForm));
      if (editingStock) setStock((rows) => rows.map((s) => s.id === editingStock ? data.listing : s));
      else setStock((rows) => [data.listing, ...rows]);
      setStockForm(blankStock); setEditingStock(null); showToast("Stock saved");
    });
  }

  function editStockItem(item: Listing) {
    setEditingStock(item.id);
    setStockForm({
      name: item.name, description: item.description, category: item.category,
      quantity: item.quantity || "", availability: item.availability,
      location: item.currentLocation, images: item.images.filter((x) => !x.includes("/placeholders/")),
    });
  }

  async function removeStock(id: string) {
    await run(`stock-${id}`, async () => {
      await api(`/api/stock/${id}`, { method: "DELETE" });
      setStock((rows) => rows.filter((s) => s.id !== id)); showToast("Stock removed");
    });
  }

  if (!authReady || loading) return <PageMessage>Loading your profile…</PageMessage>;
  if (!signedIn || !account) {
    return (
      <PageMessage>
        <h1 className="font-display text-4xl">Manage Profile</h1>
        <p className="mt-3 text-white/55">Sign in to manage your public profile.</p>
        <PrimaryButton href="/sign-in" showArrow={false} className="mt-7 rounded-lg">Sign In</PrimaryButton>
      </PageMessage>
    );
  }
  if (!account.emailVerified || !account.onboardingComplete) return <PageMessage>Redirecting…</PageMessage>;

  return (
    <div className="min-h-[100svh] bg-app-navy pb-24 pt-28 text-white">
      <Container className="max-w-4xl">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/40">Account &amp; deep manage</p>
            <h1 className="mt-2 font-display text-4xl">{account.name}</h1>
            <p className="mt-1 text-white/50">@{account.username}</p>
            <p className="mt-2 max-w-md text-sm text-white/40">
              Your public profile is the main dashboard. Use this page for full network, stock, and account tools.
            </p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link href={`/members/${account.slug}`} className="text-electric hover:text-electric-hover">Back to dashboard</Link>
            <Link href="/profile/settings" className="text-white/60 hover:text-white">Account settings</Link>
            <button type="button" onClick={() => void signOut()} className="text-white/60 hover:text-white">Sign out</button>
          </div>
        </header>

        <Panel title="Public profile" className="mt-10">
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="grid gap-5 sm:grid-cols-[160px_1fr]">
              <ImageUploadField
                label="Profile photo"
                folder="avatars"
                kind="photo"
                variant="avatar"
                value={profile.photo}
                userId={account.id}
                showToast={showToast}
                disabled={Boolean(busy)}
                onUploaded={(url) => onProfileImageUploaded("photo", url)}
              />
              <ImageUploadField
                label="Cover image"
                folder="covers"
                kind="cover"
                variant="cover"
                value={profile.cover}
                userId={account.id}
                showToast={showToast}
                disabled={Boolean(busy)}
                onUploaded={(url) => onProfileImageUploaded("cover", url)}
              />
            </div>
            <Field label="Public Display Message">
              <textarea className={`${inputClass} min-h-24 py-3`} maxLength={160} value={profile.publicDisplayMessage} onChange={(e) => setProfile({ ...profile, publicDisplayMessage: e.target.value })} />
              <span className="mt-1 block text-right text-xs text-white/35">{profile.publicDisplayMessage.length}/160</span>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><input className={inputClass} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required /></Field>
              <Field label="City"><input className={inputClass} value={profile.city} onChange={(e) => setProfile({ ...profile, city: e.target.value })} /></Field>
              <Field label="Country"><input className={inputClass} value={profile.country} onChange={(e) => setProfile({ ...profile, country: e.target.value })} /></Field>
            </div>
            <Field label="Bio"><textarea className={`${inputClass} min-h-28 py-3`} maxLength={600} value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} /></Field>
            <SubmitButton busy={busy === "profile"}>Save public profile</SubmitButton>
          </form>
        </Panel>

        <Panel title="Status Update" id="status">
          <p className="text-sm text-white/45">Expires after 24 hours. {statusLimit ? `${statusLimit.remaining} of ${statusLimit.limit} posts remaining today.` : "Maximum 3 per day."}</p>
          <form onSubmit={publishStatus} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input className={inputClass} maxLength={120} value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Share a short update" required />
            <SubmitButton busy={busy === "status"}>Publish</SubmitButton>
          </form>
        </Panel>

        <Panel title="Opportunities" id="opportunities">
          <p className="text-sm text-white/45">{opportunityLimit ? `${opportunityLimit.remaining} of ${opportunityLimit.limit} new posts remaining today.` : "Maximum 3 new posts per day."}</p>
          <div className="mt-4 space-y-3">
            {opportunities.filter((o) => o.active).map((o) => (
              <ManageRow key={o.id} title={o.title} detail={`${o.city}, ${o.country} · ${o.category}`}>
                <MiniButton onClick={() => editOpportunity(o)}>Edit</MiniButton>
                <MiniButton onClick={() => void closeOpportunity(o.id)}>Close</MiniButton>
              </ManageRow>
            ))}
            {!opportunities.some((o) => o.active) ? <Empty>No opportunity submitted.</Empty> : null}
          </div>
          <form onSubmit={saveOpportunity} className="mt-6 grid gap-3 sm:grid-cols-2">
            <input className={inputClass} placeholder="Title" value={oppForm.title} onChange={(e) => setOppForm({ ...oppForm, title: e.target.value })} required />
            <CategorySelect categories={categories} value={oppForm.category} onChange={(category) => setOppForm({ ...oppForm, category })} />
            <textarea className={`${inputClass} min-h-24 py-3 sm:col-span-2`} placeholder="Description" value={oppForm.description} onChange={(e) => setOppForm({ ...oppForm, description: e.target.value })} required />
            <input className={inputClass} placeholder="City" value={oppForm.city} onChange={(e) => setOppForm({ ...oppForm, city: e.target.value })} required />
            <input className={inputClass} placeholder="Country" value={oppForm.country} onChange={(e) => setOppForm({ ...oppForm, country: e.target.value })} required />
            <Field label="Optional expiry"><input type="date" className={inputClass} value={oppForm.expiresAt} onChange={(e) => setOppForm({ ...oppForm, expiresAt: e.target.value })} /></Field>
            <div className="flex items-end gap-2"><SubmitButton busy={busy === "opportunity"}>{editingOpp ? "Save changes" : "Create opportunity"}</SubmitButton>{editingOpp ? <MiniButton onClick={() => { setEditingOpp(null); setOppForm(blankOpportunity); }}>Cancel</MiniButton> : null}</div>
          </form>
        </Panel>

        <Panel title="Network Reach">
          <div className="space-y-2">
            {network.map((n, index) => (
              <ManageRow key={n.id} title={`${n.city}, ${n.country}`}>
                <MiniButton onClick={() => void moveNetwork(index, -1)}>↑</MiniButton>
                <MiniButton onClick={() => void moveNetwork(index, 1)}>↓</MiniButton>
                <MiniButton onClick={() => { setEditingNetwork(n.id); setNetworkForm({ city: n.city, country: n.country }); }}>Edit</MiniButton>
                <MiniButton onClick={() => void removeNetwork(n.id)}>Remove</MiniButton>
              </ManageRow>
            ))}
            {!network.length ? <Empty>No network locations added.</Empty> : null}
          </div>
          <form onSubmit={saveNetwork} className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input className={inputClass} placeholder="City" value={networkForm.city} onChange={(e) => setNetworkForm({ ...networkForm, city: e.target.value })} required />
            <input className={inputClass} placeholder="Country" value={networkForm.country} onChange={(e) => setNetworkForm({ ...networkForm, country: e.target.value })} required />
            <SubmitButton busy={busy === "network"}>{editingNetwork ? "Save" : "Add"}</SubmitButton>
          </form>
        </Panel>

        <Panel title="Upcoming Travels" id="trips">
          <div className="space-y-2">
            {trips.map((t) => (
              <ManageRow key={t.id} title={`${t.city}, ${t.country}`} detail={`${t.arrival} → ${t.departure}`}>
                <MiniButton onClick={() => { setEditingTrip(t.id); setTripForm({ city: t.city, country: t.country, arrival: t.arrival, departure: t.departure }); }}>Edit</MiniButton>
                <MiniButton onClick={() => void removeTrip(t.id)}>Remove</MiniButton>
              </ManageRow>
            ))}
            {!trips.length ? <Empty>No upcoming travel added.</Empty> : null}
          </div>
          <form onSubmit={saveTrip} className="mt-5 grid gap-3 sm:grid-cols-2">
            <input className={inputClass} placeholder="City" value={tripForm.city} onChange={(e) => setTripForm({ ...tripForm, city: e.target.value })} required />
            <input className={inputClass} placeholder="Country" value={tripForm.country} onChange={(e) => setTripForm({ ...tripForm, country: e.target.value })} required />
            <Field label="Arrival"><input type="date" className={inputClass} value={tripForm.arrival} onChange={(e) => setTripForm({ ...tripForm, arrival: e.target.value })} required /></Field>
            <Field label="Departure"><input type="date" className={inputClass} value={tripForm.departure} onChange={(e) => setTripForm({ ...tripForm, departure: e.target.value })} required /></Field>
            <SubmitButton busy={busy === "trip"}>{editingTrip ? "Save travel" : "Add travel"}</SubmitButton>
          </form>
        </Panel>

        <Panel title="Available Stock" id="stock">
          <div className="grid gap-3 sm:grid-cols-2">
            {stock.map((item) => (
              <div key={item.id} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <Image src={item.images[0]} alt="" width={72} height={72} className="h-[72px] w-[72px] rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="mt-1 text-xs text-white/40">{item.category} · {item.availability.replaceAll("_", " ")}</p>
                  <div className="mt-2 flex gap-3"><MiniButton onClick={() => editStockItem(item)}>Edit</MiniButton><MiniButton onClick={() => void removeStock(item.id)}>Remove</MiniButton></div>
                </div>
              </div>
            ))}
            {!stock.length ? <Empty>No stock listed yet.</Empty> : null}
          </div>
          <form onSubmit={saveStock} className="mt-6 grid gap-3 sm:grid-cols-2">
            <input className={inputClass} placeholder="Product name" value={stockForm.name} onChange={(e) => setStockForm({ ...stockForm, name: e.target.value })} required />
            <CategorySelect categories={categories} value={stockForm.category} onChange={(category) => setStockForm({ ...stockForm, category })} />
            <input className={inputClass} placeholder="Quantity" value={stockForm.quantity} onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })} />
            <select className={inputClass} value={stockForm.availability} onChange={(e) => setStockForm({ ...stockForm, availability: e.target.value })}>
              <option value="available">Available</option><option value="limited">Limited</option>
              <option value="made_to_order">Made to order</option><option value="to_source">Available to source</option>
            </select>
            <input className={`${inputClass} sm:col-span-2`} placeholder="Location" value={stockForm.location} onChange={(e) => setStockForm({ ...stockForm, location: e.target.value })} />
            <textarea className={`${inputClass} min-h-28 py-3 sm:col-span-2`} placeholder="Description" value={stockForm.description} onChange={(e) => setStockForm({ ...stockForm, description: e.target.value })} />
            <div className="sm:col-span-2">
              <FileButton label={busy === "stock-images" ? "Uploading…" : "Upload images"} multiple onFiles={(files) => void uploadStockImages(files)} />
              {stockForm.images.length ? <div className="mt-3 flex gap-2 overflow-x-auto">{stockForm.images.map((src, i) => <button type="button" title="Remove image" key={`${src}-${i}`} onClick={() => setStockForm((f) => ({ ...f, images: f.images.filter((_, index) => index !== i) }))} className="relative shrink-0"><Image src={src} alt="" width={64} height={64} className="h-16 w-16 rounded-lg object-cover" /><span className="absolute right-1 top-1 rounded bg-black/70 px-1 text-xs text-white">×</span></button>)}</div> : null}
            </div>
            <div className="flex gap-2"><SubmitButton busy={busy === "stock"}>{editingStock ? "Save product" : "Add product"}</SubmitButton>{editingStock ? <MiniButton onClick={() => { setEditingStock(null); setStockForm(blankStock); }}>Cancel</MiniButton> : null}</div>
          </form>
        </Panel>

        <Panel title="Connections">
          <div className="flex flex-wrap gap-5 text-sm">
            <Link href="/profile/followers" className="text-electric hover:text-electric-hover">{counts.followers} Followers</Link>
            <Link href="/profile/following" className="text-electric hover:text-electric-hover">{counts.following} Following</Link>
          </div>
        </Panel>
      </Container>
    </div>
  );
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
function PageMessage({ children }: { children: ReactNode }) {
  return <div className="min-h-[70vh] bg-app-navy pb-20 pt-32 text-center text-white"><Container className="max-w-lg">{children}</Container></div>;
}
function Panel({ title, children, className = "", id }: { title: string; children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`panel-navy mt-6 scroll-mt-24 rounded-xl px-5 py-6 sm:px-6 ${className}`}><h2 className="mb-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">{title}</h2>{children}</section>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs text-white/45">{label}</span>{children}</label>;
}
function SubmitButton({ children, busy }: { children: ReactNode; busy?: boolean }) {
  return <button disabled={busy} type="submit" className="inline-flex h-11 items-center justify-center rounded-lg bg-electric px-5 text-xs font-medium uppercase tracking-[0.12em] text-white transition-colors hover:bg-electric-hover disabled:opacity-50">{busy ? "Saving…" : children}</button>;
}
function MiniButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="text-xs text-white/50 hover:text-electric">{children}</button>;
}
function ManageRow({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm text-white/90">{title}</p>{detail ? <p className="mt-0.5 text-xs text-white/40">{detail}</p> : null}</div><div className="flex gap-3">{children}</div></div>;
}
function Empty({ children }: { children: ReactNode }) { return <p className="text-sm text-white/40">{children}</p>; }
function CategorySelect({ categories, value, onChange }: { categories: CategoryRow[]; value: string; onChange: (value: string) => void }) {
  return <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} required><option value="">Select category</option>{categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>;
}
function FileButton({ label, onChange, onFiles, multiple = false }: { label: string; onChange?: (file: File) => void; onFiles?: (files: FileList) => void; multiple?: boolean }) {
  return <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-white/20 px-4 text-xs text-white/70 hover:border-electric/50 hover:text-white">{label}<input type="file" accept={IMAGE_ACCEPT_ATTR} multiple={multiple} className="sr-only" onChange={(e) => { if (multiple && e.target.files) onFiles?.(e.target.files); else if (e.target.files?.[0]) onChange?.(e.target.files[0]); e.target.value = ""; }} /></label>;
}
const inputClass = "input-navy h-11 w-full rounded-lg px-4 text-sm";
