import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { MemberProfileCard } from "@/components/member/MemberProfileCard";
import { getFoundingMember } from "@/data/members";

export function MeetFirstMember() {
  const member = getFoundingMember();

  return (
    <section className="py-20 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow="Community"
          title="Meet The First Member"
          description="Source Bridge launches with one featured member — a trusted presence across Thailand and Russia. More members will join on the same structure."
          className="mb-12 sm:mb-16"
        />
        <MemberProfileCard member={member} />
      </Container>
    </section>
  );
}
