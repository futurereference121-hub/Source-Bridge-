import type { Member } from "@/lib/types";
import { ServiceTag } from "@/components/members/ServiceTag";

type MemberServicesGridProps = {
  member: Member;
};

export function MemberServicesGrid({ member }: MemberServicesGridProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {member.services.map((service) => (
        <ServiceTag key={service.id} label={service.label} />
      ))}
    </div>
  );
}
