"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  getSavedProfiles,
  saveSearch,
  toggleSavedProfile,
} from "@/lib/prototype-store";
import type { AccountIntent, AccountSession } from "@/lib/types";
import { NotificationListener } from "@/components/notifications/NotificationListener";

const VERIFY_PREVIEW_KEY = "sb_verify_preview";

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
  account: AccountSession | null;
  signedIn: boolean;
  authReady: boolean;
  follows: string[];
  savedProfiles: string[];
  toast: Toast | null;
  prompt: PromptState;
  showToast: (message: string) => void;
  closePrompt: () => void;
  requireAuth: (actionLabel?: string, nextPath?: string) => boolean;
  followMember: (memberId: string, name: string) => Promise<void> | void;
  saveProfile: (memberId: string, name: string) => void;
  saveCurrentSearch: (label: string) => void;
  join: (data: {
    name: string;
    email: string;
    username: string;
    password: string;
    confirmPassword: string;
    intent: AccountIntent;
  }) => Promise<void>;
  signIn: (data: { identifier: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAccount: () => Promise<AccountSession | null>;
  openPlaceholder: (title: string, message: string) => void;
};

const AppUiContext = createContext<AppUiContextValue | null>(null);

async function parseError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data.error) return data.error;
  } catch {
    /* ignore */
  }
  return "Something went wrong";
}

export function AppProviders({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [account, setAccount] = useState<AccountSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [follows, setFollows] = useState<string[]>([]);
  const [savedProfiles, setSavedProfiles] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [prompt, setPrompt] = useState<PromptState>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Kept dependency-free (via ref for the timer) so its identity is stable
  // across renders — consumers can safely depend on it without effects
  // re-running on every toast.
  const showToast = useCallback((message: string) => {
    const id = Date.now();
    setToast({ id, message });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 5500);
  }, []);

  const loadFollows = useCallback(async () => {
    try {
      const res = await fetch("/api/follow?kind=following");
      if (!res.ok) {
        setFollows([]);
        return;
      }
      const data = (await res.json()) as { items?: { id: string }[] };
      setFollows((data.items || []).map((i) => i.id));
    } catch {
      setFollows([]);
    }
  }, []);

  const refreshAccount = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = (await res.json()) as { account: AccountSession | null };
      setAccount(data.account);
      if (data.account) {
        void loadFollows();
      } else {
        setFollows([]);
      }
      return data.account;
    } catch {
      setAccount(null);
      setFollows([]);
      return null;
    }
  }, [loadFollows]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSavedProfiles(getSavedProfiles());
      try {
        const res = await fetch("/api/auth/me");
        const data = (await res.json()) as { account: AccountSession | null };
        if (cancelled) return;
        setAccount(data.account);
        setAuthReady(true);
        if (data.account) {
          void loadFollows();
        } else {
          setFollows([]);
        }
      } catch {
        if (cancelled) return;
        setAccount(null);
        setFollows([]);
        setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadFollows]);

  const closePrompt = useCallback(() => setPrompt(null), []);

  const requireAuth = useCallback((actionLabel = "continue", nextPath?: string) => {
    if (account) return true;
    const rawNext =
      nextPath ||
      (typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/explore");
    const next =
      !rawNext.startsWith("/") ||
      rawNext.startsWith("//") ||
      rawNext === "/admin" ||
      rawNext.startsWith("/admin/")
        ? "/explore"
        : rawNext;
    setPrompt({
      kind: "auth",
      title: "Join to continue",
      message: `Sign in or join Source Bridge to ${actionLabel}.`,
      confirmLabel: "Sign in",
      href: `/sign-in?next=${encodeURIComponent(next)}`,
    });
    return false;
  }, [account]);

  const followMember = useCallback(
    async (memberId: string, name: string) => {
      if (!requireAuth("follow members")) return;
      try {
        const res = await fetch("/api/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberId }),
        });
        if (!res.ok) {
          showToast(await parseError(res));
          return;
        }
        const data = (await res.json()) as { following: boolean };
        setFollows((prev) => {
          const set = new Set(prev);
          if (data.following) set.add(memberId);
          else set.delete(memberId);
          return Array.from(set);
        });
        showToast(data.following ? `Following ${name}` : `Unfollowed ${name}`);
      } catch {
        showToast("Could not update follow");
      }
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
    async (data: {
      name: string;
      email: string;
      username: string;
      password: string;
      confirmPassword: string;
      intent: AccountIntent;
    }) => {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        showToast(await parseError(res));
        return;
      }
      const payload = (await res.json()) as {
        account: AccountSession;
        previewUrl?: string | null;
        next?: string;
      };
      setAccount(payload.account);
      if (payload.previewUrl) {
        sessionStorage.setItem(VERIFY_PREVIEW_KEY, payload.previewUrl);
      }
      showToast("Welcome to Source Bridge");
      router.push(payload.next || "/check-email");
    },
    [router, showToast],
  );

  const signIn = useCallback(
    async (data: { identifier: string; password: string }) => {
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}) as { error?: string; code?: string });
        if (errorPayload.code === "NEED_PASSWORD") {
          showToast("Set a password to continue");
          router.push(`/set-password?email=${encodeURIComponent(data.identifier)}`);
          return;
        }
        showToast(errorPayload.error || "Something went wrong");
        return;
      }
      const payload = (await res.json()) as {
        account: AccountSession;
        next?: string;
      };
      setAccount(payload.account);
      await loadFollows();
      showToast("Signed in");
      router.push(payload.next || "/explore");
    },
    [loadFollows, router, showToast],
  );

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
    } catch {
      /* still clear local */
    }
    setAccount(null);
    setFollows([]);
    sessionStorage.removeItem(VERIFY_PREVIEW_KEY);
    showToast("Signed out");
    router.push("/");
  }, [router, showToast]);

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
      authReady,
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
      signOut,
      refreshAccount,
      openPlaceholder,
    }),
    [
      account,
      authReady,
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
      signOut,
      refreshAccount,
      openPlaceholder,
    ],
  );

  return (
    <AppUiContext.Provider value={value}>
      {children}
      <NotificationListener />
      {toast ? (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-[70] max-w-sm -translate-x-1/2 rounded-lg border border-white/15 bg-[#04122a] px-4 py-3 text-sm text-white shadow-lg md:bottom-8"
        >
          {toast.message}
        </div>
      ) : null}
      {prompt ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            className="panel-navy w-full max-w-md rounded-xl p-6 text-white shadow-xl"
          >
            <h2 className="font-display text-2xl text-white">{prompt.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-white/65">
              {prompt.message}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {prompt.kind === "auth" ? (
                <>
                  <button
                    type="button"
                    className="inline-flex h-11 items-center rounded-lg bg-electric px-5 text-sm font-medium text-white hover:bg-electric-hover"
                    onClick={() => {
                      closePrompt();
                      router.push(prompt.href || "/join");
                    }}
                  >
                    {prompt.confirmLabel || "Join"}
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-11 items-center rounded-lg border border-white/20 px-5 text-sm font-medium text-white hover:border-electric/50"
                    onClick={() => {
                      closePrompt();
                      router.push("/sign-in");
                    }}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-11 items-center px-3 text-sm text-white/50 hover:text-white"
                    onClick={closePrompt}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="inline-flex h-11 items-center rounded-lg bg-electric px-5 text-sm font-medium text-white hover:bg-electric-hover"
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

export { VERIFY_PREVIEW_KEY };
