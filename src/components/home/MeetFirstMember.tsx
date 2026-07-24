import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { MemberCard } from "@/components/profile/MemberCard";
import { getLaunchMember } from "@/data/members";

export function MeetFirstMember() {
  const member = getLaunchMember();

  return (
    <section className="py-20 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow="Community"
          title="Meet a member of the bridge"
          description="Source Bridge launches with one community member across Thailand and Russia. Every future member uses this same storefront structure — equal, human, and local."
          className="mb-12 sm:mb-16"
        />
        <MemberCard member={member} />
      </Container>
    </section>
  );
}
