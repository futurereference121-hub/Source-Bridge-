"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { PrimaryButton } from "@/components/ui/PrimaryButton";

type IdentityValues = {
  username: string;
  fullName: string;
  bio: string;
  photo: string;
  cover: string;
};

type Props = {
  initial: IdentityValues;
  onContinue: (values: IdentityValues) => Promise<void>;
  showToast: (message: string) => void;
};

export function IdentityStep({ initial, onContinue, showToast }: Props) {
  const [username, setUsername] = useState(initial.username);
  const [fullName, setFullName] = useState(initial.fullName);
  const [bio, setBio] = useState(initial.bio);
  const [photo, setPhoto] = useState(initial.photo);
  const [cover, setCover] = useState(initial.cover);
  const [availability, setAvailability] = useState<
    "idle" | "checking" | "ok" | "taken" | "invalid"
  >("idle");
  const [availabilityMsg, setAvailabilityMsg] = useState("");
  const [uploading, setUploading] = useState<"photo" | "cover" | null>(null);
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

  async function uploadFile(file: File, folder: "avatars" | "covers") {
    const form = new FormData();
    form.append("file", file);
    form.append("folder", folder);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = (await res.json()) as { error?: string; url?: string };
    if (!res.ok || !data.url) {
      throw new Error(data.error || "Upload failed");
    }
    return data.url;
  }

  async function onPhotoChange(file: File | null) {
    if (!file) return;
    setUploading("photo");
    try {
      const url = await uploadFile(file, "avatars");
      setPhoto(url);
      showToast("Photo uploaded");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  async function onCoverChange(file: File | null) {
    if (!file) return;
    setUploading("cover");
    try {
      const url = await uploadFile(file, "covers");
      setCover(url);
      showToast("Cover uploaded");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

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
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-white/45">
            Profile photo
          </p>
          <div className="mt-2 flex items-center gap-3">
            <div className="relative h-16 w-16 overflow-hidden rounded-full border border-white/15 bg-white/5">
              {photo ? (
                <Image
                  src={photo}
                  alt=""
                  fill
                  sizes="64px"
                  unoptimized
                  className="object-cover"
                />
              ) : null}
            </div>
            <label className="cursor-pointer text-sm text-electric hover:underline">
              {uploading === "photo"
                ? "Uploading…"
                : photo
                  ? "Replace"
                  : "Upload"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading !== null}
                onChange={(e) => onPhotoChange(e.target.files?.[0] || null)}
              />
            </label>
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-white/45">
            Cover <span className="normal-case tracking-normal">(optional)</span>
          </p>
          <div className="mt-2">
            <div className="relative h-16 w-full overflow-hidden rounded-lg border border-white/15 bg-white/5">
              {cover ? (
                <Image
                  src={cover}
                  alt=""
                  fill
                  sizes="400px"
                  unoptimized
                  className="object-cover"
                />
              ) : null}
            </div>
            <label className="mt-2 inline-block cursor-pointer text-sm text-electric hover:underline">
              {uploading === "cover"
                ? "Uploading…"
                : cover
                  ? "Replace"
                  : "Upload"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading !== null}
                onChange={(e) => onCoverChange(e.target.files?.[0] || null)}
              />
            </label>
          </div>
        </div>
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
        disabled={submitting || availability === "taken" || availability === "invalid"}
      >
        {submitting ? "Saving…" : "Continue"}
      </PrimaryButton>
    </form>
  );
}
