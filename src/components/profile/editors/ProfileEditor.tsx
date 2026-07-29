"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ImageUploadField } from "@/components/profile/ImageUploadField";
import { useAppUi } from "@/components/providers/AppProviders";
import { PUBLIC_DISPLAY_MESSAGE_MAX } from "@/lib/limits";
import {
  EditorField,
  EditorShell,
  EditorSubmit,
  apiJson,
  editorInputClass,
  jsonBody,
} from "@/components/profile/editors/EditorShell";

type ProfileEditorProps = {
  onClose: () => void;
};

type ProfileForm = {
  name: string;
  bio: string;
  city: string;
  country: string;
  publicDisplayMessage: string;
  photo: string;
  cover: string;
};

const blank: ProfileForm = {
  name: "",
  bio: "",
  city: "",
  country: "",
  publicDisplayMessage: "",
  photo: "",
  cover: "",
};

export function ProfileEditor({ onClose }: ProfileEditorProps) {
  const router = useRouter();
  const { account, showToast, refreshAccount } = useAppUi();
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson("/api/profile");
        const m = data.member;
        if (!cancelled) {
          setForm({
            name: m?.fullName || account?.name || "",
            bio: m?.bio || "",
            city: m?.location?.city || "",
            country: m?.location?.country || "",
            publicDisplayMessage: m?.publicDisplayMessage || "",
            photo: m?.photo || "",
            cover: m?.cover || "",
          });
        }
      } catch (err) {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : "Failed to load profile");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account?.name, showToast]);

  async function onImageUploaded(kind: "photo" | "cover", url: string) {
    setForm((p) => ({ ...p, [kind]: url }));
    await apiJson("/api/profile", jsonBody("PATCH", { [kind]: url }));
    if (kind === "photo") await refreshAccount();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiJson(
        "/api/profile",
        jsonBody("PATCH", {
          name: form.name.trim(),
          bio: form.bio,
          city: form.city.trim(),
          country: form.country.trim(),
          publicDisplayMessage: form.publicDisplayMessage.trim(),
          photo: form.photo,
          cover: form.cover,
        }),
      );
      await refreshAccount();
      showToast("Profile saved");
      onClose();
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  }

  if (!account) {
    return (
      <EditorShell title="Edit Profile" onClose={onClose}>
        <p className="text-sm text-white/45">Sign in to edit your profile.</p>
      </EditorShell>
    );
  }

  return (
    <EditorShell title="Edit Profile" onClose={onClose} wide>
      {loading ? (
        <p className="text-sm text-white/45">Loading…</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-5 sm:grid-cols-[160px_1fr]">
            <ImageUploadField
              label="Profile photo"
              folder="avatars"
              kind="photo"
              variant="avatar"
              value={form.photo}
              userId={account.id}
              showToast={showToast}
              disabled={busy}
              onBusyChange={setUploading}
              onUploaded={(url) => onImageUploaded("photo", url)}
            />
            <ImageUploadField
              label="Cover image"
              folder="covers"
              kind="cover"
              variant="cover"
              value={form.cover}
              userId={account.id}
              showToast={showToast}
              disabled={busy}
              onBusyChange={setUploading}
              onUploaded={(url) => onImageUploaded("cover", url)}
            />
          </div>
          <EditorField label="Public Display Message">
            <textarea
              className={`${editorInputClass} min-h-24 py-3`}
              maxLength={PUBLIC_DISPLAY_MESSAGE_MAX}
              value={form.publicDisplayMessage}
              onChange={(e) =>
                setForm({ ...form, publicDisplayMessage: e.target.value })
              }
            />
            <span className="mt-1 block text-right text-xs text-white/35">
              {form.publicDisplayMessage.length}/{PUBLIC_DISPLAY_MESSAGE_MAX}
            </span>
          </EditorField>
          <div className="grid gap-3 sm:grid-cols-2">
            <EditorField label="Name">
              <input
                className={editorInputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </EditorField>
            <EditorField label="City">
              <input
                className={editorInputClass}
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </EditorField>
            <EditorField label="Country">
              <input
                className={editorInputClass}
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
              />
            </EditorField>
          </div>
          <EditorField label="Bio">
            <textarea
              className={`${editorInputClass} min-h-28 py-3`}
              maxLength={600}
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
          </EditorField>
          <EditorSubmit busy={busy || uploading}>
            {uploading ? "Uploading photo…" : "Save profile"}
          </EditorSubmit>
        </form>
      )}
    </EditorShell>
  );
}
