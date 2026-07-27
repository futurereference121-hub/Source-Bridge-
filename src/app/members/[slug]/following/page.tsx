import { notFound } from "next/navigation";
import { FollowList } from "@/components/profile/FollowList";
import { getMemberBySlugAsync } from "@/lib/members-service";

export default async function MemberFollowingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const member = await getMemberBySlugAsync(slug);
  if (!member) notFound();
  return <FollowList kind="following" userId={member.id} title={`@${member.username}'s following`} />;
}
