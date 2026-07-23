import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Globe2, ShieldCheck, Sparkles, Truck } from "lucide-react";

const reasons = [
  {
    icon: ShieldCheck,
    title: "Trusted networks",
    body: "Vetted makers, factories, and artisans across Thailand and Russia with quality standards you can rely on.",
  },
  {
    icon: Sparkles,
    title: "Curated retail eye",
    body: "Every product is selected for craftsmanship, relevance, and presentation — ready for discerning customers.",
  },
  {
    icon: Globe2,
    title: "Scalable geography",
    body: "Built around Thailand and Russia today, with architecture ready to expand into additional markets.",
  },
  {
    icon: Truck,
    title: "End-to-end delivery",
    body: "From sample to shipment — procurement, consolidation, and worldwide logistics coordination.",
  },
];

export function WhySourceBridge() {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow="Why Source Bridge"
          title="Premium sourcing with retail discipline."
          description="We combine international trading expertise with a storefront sensibility — so every partnership feels as polished as the products themselves."
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
