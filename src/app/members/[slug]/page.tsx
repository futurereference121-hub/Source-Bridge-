import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MemberProfileView } from "@/components/profile/MemberProfileView";
import { getMemberBySlugAsync } from "@/lib/members-service";
import { getSessionUser } from "@/lib/auth";
import { getListingsForMember } from "@/data/products";
import { resolveTrustPassportPublicSummary } from "@/lib/trust-passport";
import type { TrustPassportTier } from "@/lib/trust-passport/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const member = await getMemberBySlugAsync(slug);
  if (!member) return { title: "Member" };
  return {
    title: `@${member.username}`,
    description: member.howICanHelp,
  };
}

export default async function MemberProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const [member, session] = await Promise.all([
    getMemberBySlugAsync(slug),
    getSessionUser(),
  ]);
  if (!member) notFound();

  const isOwner =
    session?.id === member.id ||
    Boolean(
      session?.username &&
        session.username.toLowerCase() === member.username.toLowerCase(),
    );
  const listings = member.isRealAccount
    ? (member.listings ?? [])
    : getListingsForMember(member);

  // Trust Passport summary for genuine interactive profiles only.
  // Not attached to Explore card queries — profile page only.
  // Gate via existing Member flags + id prefixes only (no isExample — WIP-only).
  let trustPassportTier: TrustPassportTier | null = null;
  if (
    member.isRealAccount &&
    !member.isDemo &&
    !member.isPrototype &&
    !member.id.startsWith("m-") &&
    !member.id.startsWith("example-")
  ) {
    const summary = await resolveTrustPassportPublicSummary(member.id);
    trustPassportTier = summary.available ? summary.tier : null;
  }

  return (
    <div className="pt-16 sm:pt-20">
      <MemberProfileView
        member={member}
        isOwner={isOwner}
        listings={listings}
        trustPassportTier={trustPassportTier}
      />
    </div>
  );
}
