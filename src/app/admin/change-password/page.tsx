"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function ChangePasswordPage() {
  const router = useRouter(); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: form.get("currentPassword"), password: form.get("password") }) });
    if (!response.ok) { setMessage((await response.json().catch(() => ({}))).error || "Could not change password"); return; }
    router.replace("/admin");
  }
  return <div className="mx-auto max-w-md"><h1 className="text-3xl font-semibold">Set a new password</h1><p className="mt-2 text-white/60">Your temporary password must be replaced before continuing.</p><form onSubmit={submit} className="mt-6 space-y-4"><input name="currentPassword" type="password" placeholder="Temporary password" className="w-full rounded-lg border border-white/15 bg-white/5 p-3" /><input name="password" type="password" placeholder="New password (12+ chars, upper/lower/digit/symbol)" className="w-full rounded-lg border border-white/15 bg-white/5 p-3" /><button className="w-full rounded-lg bg-electric p-3 font-medium text-app-navy">Change password</button>{message && <p className="text-sm text-red-300">{message}</p>}</form></div>;
}
