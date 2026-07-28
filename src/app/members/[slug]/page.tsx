import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MemberProfileView } from "@/components/profile/MemberProfileView";
import { getMemberBySlugAsync } from "@/lib/members-service";
import { getSessionUser } from "@/lib/auth";
import { getListingsForMember } from "@/data/products";

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

  return (
    <div className="pt-16 sm:pt-20">
      <MemberProfileView member={member} isOwner={isOwner} listings={listings} />
    </div>
  );
}
