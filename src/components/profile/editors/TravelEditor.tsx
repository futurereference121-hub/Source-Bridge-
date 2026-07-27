"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAppUi } from "@/components/providers/AppProviders";
import {
  EditorField,
  EditorShell,
  EditorSubmit,
  apiJson,
  editorInputClass,
  jsonBody,
} from "@/components/profile/editors/EditorShell";

type TripRow = {
  id: string;
  city: string;
  country: string;
  arrival: string;
  departure: string;
};

type TravelEditorProps = {
  onClose: () => void;
};

const blank = { city: "", country: "", arrival: "", departure: "" };

export function TravelEditor({ onClose }: TravelEditorProps) {
  const router = useRouter();
  const { showToast } = useAppUi();
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadTrips() {
    const data = await apiJson("/api/trips");
    setTrips(data.trips || []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadTrips();
      } catch (err) {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : "Failed to load trips");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editingId) {
        await apiJson(`/api/trips/${editingId}`, jsonBody("PATCH", form));
      } else {
        await apiJson("/api/trips", jsonBody("POST", form));
      }
      setForm(blank);
      setEditingId(null);
      await loadTrips();
      showToast("Travel saved");
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save travel");
    } finally {
      setBusy(false);
    }
  }

  async function removeTrip(id: string) {
    setBusy(true);
    try {
      await apiJson(`/api/trips/${id}`, { method: "DELETE" });
      setTrips((rows) => rows.filter((t) => t.id !== id));
      if (editingId === id) {
        setEditingId(null);
        setForm(blank);
      }
      showToast("Travel removed");
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not remove");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(trip: TripRow) {
    setEditingId(trip.id);
    setForm({
      city: trip.city,
      country: trip.country,
      arrival: trip.arrival?.slice(0, 10) || "",
      departure: trip.departure?.slice(0, 10) || "",
    });
  }

  return (
    <EditorShell title="Upcoming Travel" onClose={onClose} wide>
      {loading ? (
        <p className="text-sm text-white/45">Loading…</p>
      ) : (
        <>
          <div className="mb-5 space-y-2">
            {trips.map((t) => (
              <div
                key={t.id}
                className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm text-white/90">
                    {t.city}, {t.country}
                  </p>
                  <p className="mt-0.5 text-xs text-white/40">
                    {String(t.arrival).slice(0, 10)} →{" "}
                    {String(t.departure).slice(0, 10)}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => startEdit(t)}
                    className="text-xs text-white/50 hover:text-electric"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeTrip(t.id)}
                    className="text-xs text-white/50 hover:text-electric disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {!trips.length ? (
              <p className="text-sm text-white/40">No upcoming travel added.</p>
            ) : null}
          </div>

          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
            <EditorField label="City">
              <input
                className={editorInputClass}
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                required
              />
            </EditorField>
            <EditorField label="Country">
              <input
                className={editorInputClass}
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                required
              />
            </EditorField>
            <EditorField label="Arrival">
              <input
                type="date"
                className={editorInputClass}
                value={form.arrival}
                onChange={(e) => setForm({ ...form, arrival: e.target.value })}
                required
              />
            </EditorField>
            <EditorField label="Departure">
              <input
                type="date"
                className={editorInputClass}
                value={form.departure}
                onChange={(e) =>
                  setForm({ ...form, departure: e.target.value })
                }
                required
              />
            </EditorField>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <EditorSubmit busy={busy}>
                {editingId ? "Save travel" : "Add travel"}
              </EditorSubmit>
              {editingId ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setForm(blank);
                  }}
                  className="text-xs text-white/50 hover:text-electric"
                >
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>
        </>
      )}
    </EditorShell>
  );
}
