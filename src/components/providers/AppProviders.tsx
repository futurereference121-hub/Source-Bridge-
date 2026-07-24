"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  getAccount,
  getFollows,
  getSavedProfiles,
  isSignedIn,
  saveAccount,
  saveSearch,
  toggleFollow,
  toggleSavedProfile,
  type PrototypeAccount,
} from "@/lib/prototype-store";
import type { AccountIntent } from "@/lib/types";

type Toast = { id: number; message: string };

type PromptKind = "auth" | "info";

type PromptState = {
  kind: PromptKind;
  title: string;
  message: string;
  confirmLabel?: string;
  href?: string;
} | null;

type AppUiContextValue = {
  account: PrototypeAccount | null;
  signedIn: boolean;
  follows: string[];
  savedProfiles: string[];
  toast: Toast | null;
  prompt: PromptState;
  showToast: (message: string) => void;
  closePrompt: () => void;
  requireAuth: (actionLabel?: string) => boolean;
  followMember: (memberId: string, name: string) => void;
  saveProfile: (memberId: string, name: string) => void;
  saveCurrentSearch: (label: string) => void;
  join: (data: { name: string; email: string; intent: AccountIntent }) => void;
  signIn: (data: { email: string; name?: string }) => void;
  openPlaceholder: (title: string, message: string) => void;
};

const AppUiContext = createContext<AppUiContextValue | null>(null);

export function AppProviders({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [account, setAccount] = useState<PrototypeAccount | null>(null);
  const [follows, setFollows] = useState<string[]>([]);
  const [savedProfiles, setSavedProfiles] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [prompt, setPrompt] = useState<PromptState>(null);
  const [toastTimer, setToastTimer] = useState<number | null>(null);

  useEffect(() => {
    setAccount(getAccount());
    setFollows(getFollows());
    setSavedProfiles(getSavedProfiles());
  }, []);

  const showToast = useCallback((message: string) => {
    const id = Date.now();
    setToast({ id, message });
    if (toastTimer) window.clearTimeout(toastTimer);
    const t = window.setTimeout(() => setToast(null), 2800);
    setToastTimer(t);
  }, [toastTimer]);

  const closePrompt = useCallback(() => setPrompt(null), []);

  const requireAuth = useCallback(
    (actionLabel = "continue") => {
      if (isSignedIn()) return true;
      setPrompt({
        kind: "auth",
        title: "Join to continue",
        message: `Sign in or join Source Bridge to ${actionLabel}.`,
        confirmLabel: "Join",
        href: "/join",
      });
      return false;
    },
    [],
  );

  const followMember = useCallback(
    (memberId: string, name: string) => {
      if (!requireAuth("follow members")) return;
      const following = toggleFollow(memberId);
      setFollows(getFollows());
      showToast(following ? `Following ${name}` : `Unfollowed ${name}`);
    },
    [requireAuth, showToast],
  );

  const saveProfile = useCallback(
    (memberId: string, name: string) => {
      if (!requireAuth("save profiles")) return;
      const saved = toggleSavedProfile(memberId);
      setSavedProfiles(getSavedProfiles());
      showToast(saved ? `Saved ${name}` : `Removed ${name} from saved`);
    },
    [requireAuth, showToast],
  );

  const saveCurrentSearch = useCallback(
    (label: string) => {
      if (!requireAuth("save searches")) return;
      saveSearch(label);
      showToast("Search saved");
    },
    [requireAuth, showToast],
  );

  const join = useCallback(
    (data: { name: string; email: string; intent: AccountIntent }) => {
      const next: PrototypeAccount = {
        name: data.name,
        email: data.email,
        intent: data.intent,
        createdAt: new Date().toISOString(),
      };
      saveAccount(next);
      setAccount(next);
      showToast("Welcome to Source Bridge");
      router.push("/explore");
    },
    [router, showToast],
  );

  const signIn = useCallback(
    (data: { email: string; name?: string }) => {
      const existing = getAccount();
      const next: PrototypeAccount = existing ?? {
        name: data.name || data.email.split("@")[0] || "Member",
        email: data.email,
        intent: "both",
        createdAt: new Date().toISOString(),
      };
      if (!existing) {
        next.email = data.email;
        if (data.name) next.name = data.name;
      } else {
        next.email = data.email;
      }
      saveAccount(next);
      setAccount(next);
      showToast("Signed in");
      router.push("/explore");
    },
    [router, showToast],
  );

  const openPlaceholder = useCallback((title: string, message: string) => {
    setPrompt({
      kind: "info",
      title,
      message,
      confirmLabel: "Got it",
    });
  }, []);

  const value = useMemo(
    () => ({
      account,
      signedIn: Boolean(account),
      follows,
      savedProfiles,
      toast,
      prompt,
      showToast,
      closePrompt,
      requireAuth,
      followMember,
      saveProfile,
      saveCurrentSearch,
      join,
      signIn,
      openPlaceholder,
    }),
    [
      account,
      follows,
      savedProfiles,
      toast,
      prompt,
      showToast,
      closePrompt,
      requireAuth,
      followMember,
      saveProfile,
      saveCurrentSearch,
      join,
      signIn,
      openPlaceholder,
    ],
  );

  return (
    <AppUiContext.Provider value={value}>
      {children}
      {toast ? (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-[70] max-w-sm -translate-x-1/2 border border-border bg-ink px-4 py-3 text-sm text-white shadow-lg md:bottom-8"
        >
          {toast.message}
        </div>
      ) : null}
      {prompt ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/40 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md border border-border bg-surface p-6 shadow-xl"
          >
            <h2 className="font-display text-2xl text-ink">{prompt.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {prompt.message}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {prompt.kind === "auth" ? (
                <>
                  <button
                    type="button"
                    className="inline-flex h-11 items-center bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover"
                    onClick={() => {
                      closePrompt();
                      router.push(prompt.href || "/join");
                    }}
                  >
                    {prompt.confirmLabel || "Join"}
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-11 items-center border border-border px-5 text-sm font-medium text-ink hover:border-ink"
                    onClick={() => {
                      closePrompt();
                      router.push("/sign-in");
                    }}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-11 items-center px-3 text-sm text-muted hover:text-ink"
                    onClick={closePrompt}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="inline-flex h-11 items-center bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover"
                  onClick={closePrompt}
                >
                  {prompt.confirmLabel || "Got it"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </AppUiContext.Provider>
  );
}

export function useAppUi() {
  const ctx = useContext(AppUiContext);
  if (!ctx) throw new Error("useAppUi must be used within AppProviders");
  return ctx;
}
