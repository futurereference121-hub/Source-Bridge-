"use client";
import { FormEvent, useEffect, useState } from "react";
import { useAppUi } from "@/components/providers/AppProviders";

export default function AdminSignInPage() {
  const { account, authReady, refreshAccount } = useAppUi();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Admin → verification queue. Ordinary signed-in users → Explore (never admin UI).
  useEffect(() => {
    if (!authReady) return;
    if (!account) return;
    const isAdmin = account.role === "ADMIN" || account.isAdmin;
    if (isAdmin) {
      window.location.replace("/admin/verifications");
      return;
    }
    window.location.replace("/explore");
  }, [authReady, account]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const data = new FormData(event.currentTarget);
    const username = (data.get("username") as string | null)?.trim().toLowerCase() ?? "";
    const password = (data.get("password") as string | null) ?? "";
    try {
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
      if (json.code === "NEED_FIRST_PASSWORD") {
        window.location.replace(json.next || "/admin/create-password");
        return;
      }
      // Sync AppProviders account state, then do a full navigation so the
      // browser sends the freshly-set sb_role cookie on the next request —
      // this eliminates any timing race between the Set-Cookie response header
      // and the middleware reading the cookie on a client-side navigation.
      await refreshAccount();
      window.location.replace(json.next || "/admin/verifications");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Don't flash the form while checking existing session.
  if (!authReady) {
    return (
      <div className="mx-auto max-w-md">
        <p className="text-white/50">Loading…</p>
      </div>
    );
  }

  // Already authenticated — redirect is firing in useEffect. Never flash the form.
  if (account) {
    return (
      <div className="mx-auto max-w-md">
        <p className="text-white/50">Redirecting…</p>
      </div>
    );
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
        <button
          disabled={submitting}
          className="w-full rounded-lg bg-electric p-3 font-medium text-app-navy disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </form>
    </div>
  );
}
