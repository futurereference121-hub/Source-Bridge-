"use client";

import { useState, type FormEvent } from "react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";

type NetworkRow = { city: string; country: string };
type TripRow = {
  city: string;
  country: string;
  arrival: string;
  departure: string;
};

type LocationValues = {
  city: string;
  country: string;
  network: NetworkRow[];
  trips: TripRow[];
};

type Props = {
  initial: LocationValues;
  onContinue: (values: LocationValues) => Promise<void>;
  showToast: (message: string) => void;
};

export function LocationStep({ initial, onContinue, showToast }: Props) {
  const [city, setCity] = useState(initial.city);
  const [country, setCountry] = useState(initial.country);
  const [network, setNetwork] = useState<NetworkRow[]>(
    initial.network.length ? initial.network : [],
  );
  const [netCity, setNetCity] = useState("");
  const [netCountry, setNetCountry] = useState("");
  const [trips, setTrips] = useState<TripRow[]>(initial.trips);
  const [tripDraft, setTripDraft] = useState<TripRow>({
    city: "",
    country: "",
    arrival: "",
    departure: "",
  });
  const [submitting, setSubmitting] = useState(false);

  function addNetwork() {
    const c = netCity.trim();
    const co = netCountry.trim();
    if (!c || !co) return;
    setNetwork((prev) => [...prev, { city: c, country: co }]);
    setNetCity("");
    setNetCountry("");
  }

  function addTrip() {
    const draft = {
      city: tripDraft.city.trim(),
      country: tripDraft.country.trim(),
      arrival: tripDraft.arrival.trim(),
      departure: tripDraft.departure.trim(),
    };
    if (!draft.city || !draft.country || !draft.arrival || !draft.departure) {
      showToast("Fill all trip fields to add travel");
      return;
    }
    setTrips((prev) => [...prev, draft]);
    setTripDraft({ city: "", country: "", arrival: "", departure: "" });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onContinue({
        city: city.trim(),
        country: country.trim(),
        network,
        trips,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="panel-navy space-y-6 rounded-xl px-5 py-6 sm:px-6"
      onSubmit={handleSubmit}
    >
      <div>
        <h2 className="text-2xl font-semibold text-white">Location & reach</h2>
        <p className="mt-1 text-sm text-white/55">
          Where you are now, and where you can help from.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
          Current city{" "}
          <span className="normal-case tracking-normal">(optional)</span>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="input-navy mt-1.5 h-11 w-full rounded-lg px-4 text-sm"
          />
        </label>
        <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
          Current country{" "}
          <span className="normal-case tracking-normal">(optional)</span>
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="input-navy mt-1.5 h-11 w-full rounded-lg px-4 text-sm"
          />
        </label>
      </div>

      <div className="space-y-3 border-t border-white/10 pt-5">
        <p className="text-sm font-medium text-white">
          Network reach{" "}
          <span className="font-normal text-white/45">(optional)</span>
        </p>
        <p className="text-xs text-white/45">
          Cities where you can source, inspect, or connect.
        </p>
        {network.length > 0 ? (
          <ul className="space-y-2">
            {network.map((n, i) => (
              <li
                key={`${n.city}-${n.country}-${i}`}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
              >
                <span>
                  {n.city}, {n.country}
                </span>
                <button
                  type="button"
                  className="text-xs text-white/45 hover:text-white"
                  onClick={() =>
                    setNetwork((prev) => prev.filter((_, idx) => idx !== i))
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input
            value={netCity}
            onChange={(e) => setNetCity(e.target.value)}
            placeholder="City"
            className="input-navy h-11 rounded-lg px-4 text-sm"
          />
          <input
            value={netCountry}
            onChange={(e) => setNetCountry(e.target.value)}
            placeholder="Country"
            className="input-navy h-11 rounded-lg px-4 text-sm"
          />
          <button
            type="button"
            onClick={addNetwork}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-white/15 px-4 text-sm text-white/80 hover:border-electric/40"
          >
            Add
          </button>
        </div>
      </div>

      <div className="space-y-3 border-t border-white/10 pt-5">
        <p className="text-sm font-medium text-white">
          Upcoming travel{" "}
          <span className="font-normal text-white/45">(optional)</span>
        </p>
        {trips.length > 0 ? (
          <ul className="space-y-2">
            {trips.map((t, i) => (
              <li
                key={`${t.city}-${t.arrival}-${i}`}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
              >
                <span>
                  {t.city}, {t.country} · {t.arrival} → {t.departure}
                </span>
                <button
                  type="button"
                  className="text-xs text-white/45 hover:text-white"
                  onClick={() =>
                    setTrips((prev) => prev.filter((_, idx) => idx !== i))
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={tripDraft.city}
            onChange={(e) =>
              setTripDraft((d) => ({ ...d, city: e.target.value }))
            }
            placeholder="City"
            className="input-navy h-11 rounded-lg px-4 text-sm"
          />
          <input
            value={tripDraft.country}
            onChange={(e) =>
              setTripDraft((d) => ({ ...d, country: e.target.value }))
            }
            placeholder="Country"
            className="input-navy h-11 rounded-lg px-4 text-sm"
          />
          <label className="block text-xs text-white/45">
            Arrival
            <input
              type="date"
              value={tripDraft.arrival}
              onChange={(e) =>
                setTripDraft((d) => ({ ...d, arrival: e.target.value }))
              }
              className="input-navy mt-1 h-11 w-full rounded-lg px-4 text-sm"
            />
          </label>
          <label className="block text-xs text-white/45">
            Departure
            <input
              type="date"
              value={tripDraft.departure}
              onChange={(e) =>
                setTripDraft((d) => ({ ...d, departure: e.target.value }))
              }
              className="input-navy mt-1 h-11 w-full rounded-lg px-4 text-sm"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={addTrip}
          className="text-sm text-electric hover:underline"
        >
          Add trip
        </button>
      </div>

      <PrimaryButton type="submit" showArrow={false} disabled={submitting}>
        {submitting ? "Saving…" : "Continue"}
      </PrimaryButton>
    </form>
  );
}
