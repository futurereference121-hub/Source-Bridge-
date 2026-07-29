"use client";
import { useAppUi } from "@/components/providers/AppProviders";

export default function AdminSignOutButton() {
  const { signOut } = useAppUi();
  return (
    <button
      type="button"
      onClick={() => void signOut()}
      className="text-white/70 hover:text-white"
    >
      Sign out
    </button>
  );
}
