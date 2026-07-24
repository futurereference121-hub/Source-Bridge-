import { members } from "@/data/members";
import { MemberCard } from "@/components/members/MemberCard";
import { Container } from "@/components/ui/Container";

/** Legacy home tease — unused on the short homepage; kept for optional reuse. */
export function MeetFirstMember() {
  const member = members[0];
  if (!member) return null;

  return (
    <section className="py-16">
      <Container>
        <MemberCard member={member} />
      </Container>
    </section>
  );
}
