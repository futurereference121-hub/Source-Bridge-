"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppUi } from "@/components/providers/AppProviders";

export default function AdminSignInPage() {
  const router = useRouter();
  const { refreshAccount } = useAppUi();
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const username = (data.get("username") as string | null)?.trim().toLowerCase() ?? "";
    const password = (data.get("password") as string | null) ?? "";
    const response = await fetch("/api/auth/admin-sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError("Invalid credentials");
      return;
    }
    // First-time setup: no password has been created yet.
    if (json.code === "NEED_FIRST_PASSWORD") {
      router.replace(json.next || "/admin/create-password");
      return;
    }
    // Sync AppProviders so the public nav immediately reflects the admin session.
    await refreshAccount();
    router.replace(json.next || "/admin");
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">Administrator sign in</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <input
          name="username"
          defaultValue="adminsource"
          autoComplete="username"
          className="w-full rounded-lg border border-white/15 bg-white/5 p-3"
        />
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          className="w-full rounded-lg border border-white/15 bg-white/5 p-3"
        />
        <button className="w-full rounded-lg bg-electric p-3 font-medium text-app-navy">
          Sign in
        </button>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </form>
    </div>
  );
}
