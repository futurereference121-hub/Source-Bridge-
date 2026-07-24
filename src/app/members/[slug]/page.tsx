import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { members, getMemberBySlug } from "@/data/members";
import { MemberStorefront } from "@/components/profile/MemberStorefront";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return members.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const member = getMemberBySlug(slug);
  if (!member) return { title: "Member" };
  return {
    title: member.displayName,
    description: member.bio,
  };
}

export default async function MemberProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const member = getMemberBySlug(slug);
  if (!member) notFound();

  return (
    <div className="pt-16 sm:pt-20">
      <MemberStorefront member={member} />
    </div>
  );
}
