import type { AccountIntent } from "@/lib/types";

const ACCOUNT_KEY = "sb_account";
const FOLLOWS_KEY = "sb_follows";
const SAVED_PROFILES_KEY = "sb_saved_profiles";
const SAVED_SEARCHES_KEY = "sb_saved_searches";

export type PrototypeAccount = {
  name: string;
  email: string;
  intent: AccountIntent;
  createdAt: string;
};

function canUseStorage() {
  return typeof window !== "undefined";
}

export function getAccount(): PrototypeAccount | null {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as PrototypeAccount) : null;
  } catch {
    return null;
  }
}

export function saveAccount(account: PrototypeAccount) {
  if (!canUseStorage()) return;
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

export function clearAccount() {
  if (!canUseStorage()) return;
  localStorage.removeItem(ACCOUNT_KEY);
}

export function isSignedIn(): boolean {
  return Boolean(getAccount());
}

export function getFollows(): string[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(FOLLOWS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function toggleFollow(memberId: string): boolean {
  const current = getFollows();
  const next = current.includes(memberId)
    ? current.filter((id) => id !== memberId)
    : [...current, memberId];
  localStorage.setItem(FOLLOWS_KEY, JSON.stringify(next));
  return next.includes(memberId);
}

export function getSavedProfiles(): string[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(SAVED_PROFILES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function toggleSavedProfile(memberId: string): boolean {
  const current = getSavedProfiles();
  const next = current.includes(memberId)
    ? current.filter((id) => id !== memberId)
    : [...current, memberId];
  localStorage.setItem(SAVED_PROFILES_KEY, JSON.stringify(next));
  return next.includes(memberId);
}

export function getSavedSearches(): string[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(SAVED_SEARCHES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveSearch(label: string) {
  const current = getSavedSearches();
  const next = [label, ...current.filter((s) => s !== label)].slice(0, 8);
  localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(next));
}
