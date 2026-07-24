"use client";

import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { useAppUi } from "@/components/providers/AppProviders";
import {
  clearAccount,
  getSavedProfiles,
  getSavedSearches,
  getFollows,
} from "@/lib/prototype-store";
import { getMemberById } from "@/data/members";
import { useEffect, useState } from "react";

export default function ProfileDashboardPage() {
  const { account, signedIn, openPlaceholder, showToast } = useAppUi();
  const [follows, setFollows] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [searches, setSearches] = useState<string[]>([]);

  useEffect(() => {
    setFollows(getFollows());
    setSaved(getSavedProfiles());
    setSearches(getSavedSearches());
  }, [signedIn]);

  if (!signedIn || !account) {
    return (
      <div className="pt-28 pb-20">
        <Container className="max-w-lg text-center">
          <h1 className="font-display text-4xl text-ink">Your profile</h1>
          <p className="mt-3 text-muted">
            Sign in to see follows, saved profiles, and account settings.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button href="/sign-in">Sign In</Button>
            <Button href="/join" variant="outline">
              Join
            </Button>
          </div>
        </Container>
      </div>
    );
  }

  return (
    <div className="pt-28 pb-20">
      <Container className="max-w-2xl">
        <h1 className="font-display text-4xl text-ink">{account.name}</h1>
        <p className="mt-2 text-muted">{account.email}</p>
        <p className="mt-1 text-sm uppercase tracking-[0.14em] text-muted">
          Intent: {account.intent}
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              openPlaceholder(
                "Notifications",
                "Activity and alerts will appear here. Prototype placeholder only.",
              )
            }
          >
            Notifications
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              openPlaceholder(
                "Activity feed",
                "Your follows, requests, and journey updates will feed here later.",
              )
            }
          >
            Activity feed
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              clearAccount();
              showToast("Signed out");
              window.location.href = "/";
            }}
          >
            Sign out
          </Button>
        </div>

        <section className="mt-12">
          <h2 className="text-xs uppercase tracking-[0.16em] text-muted">Following</h2>
          <ul className="mt-4 space-y-2">
            {follows.length ? (
              follows.map((id) => {
                const m = getMemberById(id);
                if (!m) return null;
                return (
                  <li key={id}>
                    <Link
                      href={`/members/${m.slug}`}
                      className="text-ink underline-offset-2 hover:underline"
                    >
                      {m.fullName}
                    </Link>
                  </li>
                );
              })
            ) : (
              <li className="text-sm text-muted">Not following anyone yet.</li>
            )}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-xs uppercase tracking-[0.16em] text-muted">
            Saved profiles
          </h2>
          <ul className="mt-4 space-y-2">
            {saved.length ? (
              saved.map((id) => {
                const m = getMemberById(id);
                if (!m) return null;
                return (
                  <li key={id}>
                    <Link
                      href={`/members/${m.slug}`}
                      className="text-ink underline-offset-2 hover:underline"
                    >
                      {m.fullName}
                    </Link>
                  </li>
                );
              })
            ) : (
              <li className="text-sm text-muted">No saved profiles.</li>
            )}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-xs uppercase tracking-[0.16em] text-muted">
            Saved searches
          </h2>
          <ul className="mt-4 space-y-2">
            {searches.length ? (
              searches.map((s) => (
                <li key={s} className="text-sm text-ink">
                  {s}
                </li>
              ))
            ) : (
              <li className="text-sm text-muted">No saved searches.</li>
            )}
          </ul>
        </section>
      </Container>
    </div>
  );
}
