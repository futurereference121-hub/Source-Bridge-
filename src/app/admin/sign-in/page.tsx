"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminSignInPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/admin-sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: data.get("username"), password: data.get("password") }) });
    if (!response.ok) { setError("Invalid credentials"); return; }
    router.replace((await response.json()).next || "/admin");
  }
  return <div className="mx-auto max-w-md"><h1 className="text-3xl font-semibold">Administrator sign in</h1><form onSubmit={submit} className="mt-6 space-y-4"><input name="username" defaultValue="adminsource" autoComplete="username" className="w-full rounded-lg border border-white/15 bg-white/5 p-3" /><input name="password" type="password" autoComplete="current-password" className="w-full rounded-lg border border-white/15 bg-white/5 p-3" /><button className="w-full rounded-lg bg-electric p-3 font-medium text-app-navy">Sign in</button>{error && <p className="text-sm text-red-300">{error}</p>}</form></div>;
}
