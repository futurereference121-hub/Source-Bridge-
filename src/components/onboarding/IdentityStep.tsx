"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { ImageUploadField } from "@/components/profile/ImageUploadField";

type IdentityValues = {
  username: string;
  fullName: string;
  bio: string;
  photo: string;
  cover: string;
};

type Props = {
  userId: string;
  initial: IdentityValues;
  onContinue: (values: IdentityValues) => Promise<void>;
  showToast: (message: string) => void;
};

export function IdentityStep({
  userId,
  initial,
  onContinue,
  showToast,
}: Props) {
  const [username, setUsername] = useState(initial.username);
  const [fullName, setFullName] = useState(initial.fullName);
  const [bio, setBio] = useState(initial.bio);
  const [photo, setPhoto] = useState(initial.photo);
  const [cover, setCover] = useState(initial.cover);
  const [availability, setAvailability] = useState<
    "idle" | "checking" | "ok" | "taken" | "invalid"
  >("idle");
  const [availabilityMsg, setAvailabilityMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const u = username.trim().toLowerCase().replace(/^@/, "");
    if (u.length < 3) {
      setAvailability("idle");
      setAvailabilityMsg("");
      return;
    }
    setAvailability("checking");
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/username/check?u=${encodeURIComponent(u)}`,
        );
        const data = (await res.json()) as {
          available?: boolean;
          reason?: string;
        };
        if (!res.ok) {
          setAvailability("invalid");
          setAvailabilityMsg(data.reason || "Invalid username");
          return;
        }
        if (data.available) {
          setAvailability("ok");
          setAvailabilityMsg("Available");
        } else {
          setAvailability("taken");
          setAvailabilityMsg(data.reason || "Username is taken");
        }
      } catch {
        setAvailability("idle");
        setAvailabilityMsg("");
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [username]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cleanUser = username.trim().toLowerCase().replace(/^@/, "");
    if (!cleanUser || !fullName.trim()) return;
    if (availability === "taken" || availability === "invalid") {
      showToast(availabilityMsg || "Choose a different username");
      return;
    }
    setSubmitting(true);
    try {
      await onContinue({
        username: cleanUser,
        fullName: fullName.trim(),
        bio: bio.trim(),
        photo,
        cover,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="panel-navy space-y-5 rounded-xl px-5 py-6 sm:px-6"
      onSubmit={handleSubmit}
    >
      <div>
        <h2 className="text-2xl font-semibold text-white">Identity</h2>
        <p className="mt-1 text-sm text-white/55">
          Choose how you appear across Source Bridge.
        </p>
      </div>

      <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
        Username
        <div className="relative mt-1.5">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
            @
          </span>
          <input
            required
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/^@/, ""))}
            className="input-navy h-12 w-full rounded-lg pl-8 pr-4 text-sm"
            autoComplete="username"
            minLength={3}
            maxLength={30}
          />
        </div>
        {availabilityMsg ? (
          <p
            className={`mt-1.5 text-xs ${
              availability === "ok"
                ? "text-electric"
                : availability === "checking"
                  ? "text-white/40"
                  : "text-red-300"
            }`}
          >
            {availability === "checking" ? "Checking…" : availabilityMsg}
          </p>
        ) : null}
      </label>

      <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
        Real name
        <input
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="input-navy mt-1.5 h-12 w-full rounded-lg px-4 text-sm"
          autoComplete="name"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <ImageUploadField
          label="Profile photo"
          folder="avatars"
          kind="photo"
          variant="avatar"
          value={photo}
          userId={userId}
          onUploaded={(url) => setPhoto(url)}
          showToast={showToast}
          disabled={submitting}
        />
        <ImageUploadField
          label="Cover (optional)"
          folder="covers"
          kind="cover"
          variant="cover"
          value={cover}
          userId={userId}
          onUploaded={(url) => setCover(url)}
          showToast={showToast}
          disabled={submitting}
        />
      </div>

      <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
        Short bio{" "}
        <span className="normal-case tracking-normal">(optional)</span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          maxLength={600}
          className="input-navy mt-1.5 w-full resize-y rounded-lg px-4 py-3 text-sm"
          placeholder="A line about how you help others source."
        />
      </label>

      <PrimaryButton
        type="submit"
        showArrow={false}
        disabled={
          submitting || availability === "taken" || availability === "invalid"
        }
      >
        {submitting ? "Saving…" : "Continue"}
      </PrimaryButton>
    </form>
  );
}
