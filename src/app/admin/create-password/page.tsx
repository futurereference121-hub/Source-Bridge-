"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { validatePasswordStrength, passwordStrengthLevel } from "@/lib/password-strength";
import { useAppUi } from "@/components/providers/AppProviders";

const REQUIREMENTS = [
  { label: "At least 10 characters", test: (p: string) => p.length >= 10 },
  { label: "Uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "Number", test: (p: string) => /\d/.test(p) },
];

const LEVEL_STYLES: Record<string, string> = {
  weak: "bg-red-500",
  fair: "bg-amber-400",
  good: "bg-emerald-400",
  strong: "bg-green-500",
};

export default function AdminCreatePasswordPage() {
  const router = useRouter();
  const { refreshAccount } = useAppUi();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);

  // Verify the page should be accessible — if setup is already done, redirect.
  useEffect(() => {
    fetch("/api/auth/admin-setup-status")
      .then((r) => r.json())
      .then((json) => {
        if (json.setupComplete) {
          router.replace("/admin/sign-in");
        } else {
          setReady(true);
        }
      })
      .catch(() => router.replace("/admin/sign-in"));
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const clientError = validatePasswordStrength(password);
    if (clientError) { setError(clientError); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/admin-create-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmPassword: confirm }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json.error || "Could not set password");
        return;
      }
      // Password set — session created — sync AppProviders then do a full
      // page navigation so sb_role cookie is read fresh by middleware.
      await refreshAccount();
      window.location.replace("/admin/verifications");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (ready === null) {
    return (
      <div className="mx-auto max-w-md pt-20 text-center text-white/50">
        Checking setup status…
      </div>
    );
  }

  const level = password ? passwordStrengthLevel(password) : null;
  const levelStyle = level ? LEVEL_STYLES[level] : "";

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">Create Administrator Password</h1>
      <p className="mt-2 text-white/60">
        This page appears only once. After you create the password it will never
        be accessible again.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-5">
        <div>
          <label className="mb-1 block text-sm text-white/70">New Password</label>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-white/5 p-3 focus:outline-none focus:ring-2 focus:ring-electric"
          />
          {/* Strength bar */}
          {password && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all ${levelStyle}`}
                style={{
                  width: level === "weak" ? "25%" : level === "fair" ? "50%" : level === "good" ? "75%" : "100%",
                }}
              />
            </div>
          )}
        </div>

        {/* Requirements checklist */}
        <ul className="space-y-1">
          {REQUIREMENTS.map((req) => {
            const met = req.test(password);
            return (
              <li key={req.label} className={`flex items-center gap-2 text-sm ${met ? "text-emerald-400" : "text-white/40"}`}>
                <span>{met ? "✓" : "○"}</span>
                {req.label}
              </li>
            );
          })}
        </ul>

        <div>
          <label className="mb-1 block text-sm text-white/70">Confirm Password</label>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-white/5 p-3 focus:outline-none focus:ring-2 focus:ring-electric"
          />
          {confirm && confirm !== password && (
            <p className="mt-1 text-xs text-red-300">Passwords do not match</p>
          )}
        </div>

        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-electric p-3 font-medium text-app-navy disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create Password & Sign In"}
        </button>
      </form>
    </div>
  );
}
