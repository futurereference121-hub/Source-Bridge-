"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppUi } from "@/components/providers/AppProviders";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { refreshAccount } = useAppUi();
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: form.get("currentPassword"),
        password: form.get("password"),
        confirmPassword: form.get("confirmPassword"),
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setMessage(data.error || "Could not change password");
      return;
    }
    // Sync AppProviders so the public nav immediately reflects the refreshed session.
    await refreshAccount();
    router.replace("/admin");
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">Set a new password</h1>
      <p className="mt-2 text-white/60">
        Your temporary password must be replaced before continuing.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <input
          name="currentPassword"
          type="password"
          placeholder="Current / temporary password"
          autoComplete="current-password"
          className="w-full rounded-lg border border-white/15 bg-white/5 p-3"
        />
        <input
          name="password"
          type="password"
          placeholder="New password (10+ chars, upper/lower/digit)"
          autoComplete="new-password"
          className="w-full rounded-lg border border-white/15 bg-white/5 p-3"
        />
        <input
          name="confirmPassword"
          type="password"
          placeholder="Confirm new password"
          autoComplete="new-password"
          className="w-full rounded-lg border border-white/15 bg-white/5 p-3"
        />
        <button className="w-full rounded-lg bg-electric p-3 font-medium text-app-navy">
          Change password
        </button>
        {message && <p className="text-sm text-red-300">{message}</p>}
      </form>
    </div>
  );
}
