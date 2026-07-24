import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Globe2, Handshake, MapPin, Users } from "lucide-react";

const ways = [
  {
    icon: Users,
    title: "Be where someone needs you",
    body: "Locals and expats open doors to markets, makers, and pieces that never appear on global storefronts.",
  },
  {
    icon: MapPin,
    title: "Travel with purpose",
    body: "Upcoming journeys turn movement into help — carry, inspect, and connect along the way.",
  },
  {
    icon: Handshake,
    title: "Share taste and trust",
    body: "Members curate Available Finds and personal sourcing with judgment you can see on a real profile.",
  },
  {
    icon: Globe2,
    title: "Grow the community",
    body: "One equal member structure for everyone — ready for thousands of people across more countries.",
  },
];

export function HowPeopleHelp() {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow="How people help"
          title="Technology connects. People remain the bridge."
          description="Source Bridge exists so people can help people — through location, travel, and local knowledge."
          className="mb-14"
        />
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {ways.map((item) => (
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
