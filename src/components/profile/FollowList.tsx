"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { memberPhoto } from "@/lib/placeholders";
import { VerificationBadge } from "@/components/trust/VerificationBadge";
import { StoryAvatar } from "@/components/stories/StoryAvatar";
import { useStoriesOptional } from "@/components/stories/StoryProvider";

type FollowCard = {
  id: string;
  username: string;
  slug: string;
  fullName: string;
  photo: string;
  location: string;
  identityVerified: boolean;
};

export function FollowList({
  kind,
  userId,
  title,
}: {
  kind: "followers" | "following";
  userId?: string;
  title: string;
}) {
  const { account, signedIn, authReady, follows, followMember, requireAuth } = useAppUi();
  const stories = useStoriesOptional();
  const [items, setItems] = useState<FollowCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authReady) return;
    if (!signedIn) { setLoading(false); return; }
    const query = new URLSearchParams({ kind });
    if (userId) query.set("userId", userId);
    fetch(`/api/follow?${query}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => setItems(data.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [authReady, kind, signedIn, userId]);

  useEffect(() => {
    const ids = items.map((i) => i.id);
    if (ids.length) void stories?.refreshRings(ids);
  }, [items, stories?.refreshRings]);

  if (!authReady || loading) {
    return <Shell title={title}><p className="text-white/45">Loading…</p></Shell>;
  }
  if (!signedIn) {
    return (
      <Shell title={title}>
        <p className="text-white/55">Sign in to view followers and following.</p>
        <div className="mt-6 flex gap-3">
          <PrimaryButton href="/sign-in" showArrow={false} className="rounded-lg">Sign In</PrimaryButton>
          <button type="button" onClick={() => requireAuth("view member connections")} className="text-sm text-white/55 hover:text-white">Why sign in?</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={title}>
      <div className="space-y-3">
        {items.map((item) => (
          <article key={item.id} className="panel-navy flex items-center gap-4 rounded-xl p-4">
            <StoryAvatar
              userId={item.id}
              isSelf={account?.id === item.id}
              profileHref={`/members/${item.slug}`}
              size={56}
              className="rounded-xl ring-1 ring-white/10"
            >
              <Image
                src={memberPhoto(item.photo)}
                alt=""
                fill
                sizes="56px"
                className="object-cover"
              />
            </StoryAvatar>
            <Link href={`/members/${item.slug}`} className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate font-medium text-white">
                <span className="truncate">@{item.username}</span>
                {item.identityVerified ? (
                  <VerificationBadge verified variant="tick" size="sm" />
                ) : null}
              </p>
              <p className="truncate text-sm text-white/45">{item.location || "Location not added"}</p>
            </Link>
            {account?.id !== item.id ? (
              <button
                type="button"
                onClick={() => void followMember(item.id, `@${item.username}`)}
                className={`rounded-lg border px-4 py-2 text-xs uppercase tracking-[0.12em] ${follows.includes(item.id) ? "border-electric/40 bg-electric/10 text-electric" : "border-white/20 text-white/75 hover:border-electric/50"}`}
              >
                {follows.includes(item.id) ? "Following" : "Follow"}
              </button>
            ) : null}
          </article>
        ))}
        {!items.length ? <p className="text-sm text-white/40">No {kind} yet.</p> : null}
      </div>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-[70vh] bg-app-navy pb-24 pt-28 text-white">
      <Container className="max-w-2xl">
        <h1 className="mb-8 font-display text-4xl">{title}</h1>
        {children}
      </Container>
    </div>
  );
}
