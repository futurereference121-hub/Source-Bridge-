import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Globe2, MapPin, Sparkles, Users } from "lucide-react";

const reasons = [
  {
    icon: Users,
    title: "People first",
    body: "Trade works best when you know who you're dealing with. Members bring trust, taste, and real presence on the ground.",
  },
  {
    icon: MapPin,
    title: "Location as value",
    body: "Being somewhere — or going somewhere — is the advantage. Local access is what the marketplace is built around.",
  },
  {
    icon: Sparkles,
    title: "Curated by members",
    body: "Listings reflect human judgment: craftsmanship, relevance, and care — shared from member profiles, not stock rooms.",
  },
  {
    icon: Globe2,
    title: "Ready for more members",
    body: "Launch focuses on Thailand and Russia through our founding member. The architecture welcomes the next community members.",
  },
];

export function WhySourceBridge() {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow="Why Source Bridge"
          title="Technology connects. People remain the bridge."
          description="We design for human connection across borders — premium discovery today, richer community tools tomorrow."
          className="mb-14"
        />
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {reasons.map((item) => (
            <div key={item.title} className="border-t border-border pt-6">
              <item.icon className="mb-5 text-accent" size={22} strokeWidth={1.5} />
              <h3 className="font-display text-2xl text-ink">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
