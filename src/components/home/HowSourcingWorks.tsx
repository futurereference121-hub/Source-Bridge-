import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";

const steps = [
  {
    step: "01",
    title: "Share your brief",
    body: "Tell us the product, quantity, budget, and destination. Optional business details help us tailor the approach.",
  },
  {
    step: "02",
    title: "Source & shortlist",
    body: "We activate our Thailand and Russia networks — factories, artisans, wholesalers — and shortlist viable options.",
  },
  {
    step: "03",
    title: "Sample & confirm",
    body: "Review samples, pricing, and lead times. Refine specs until quality and commercial terms align.",
  },
  {
    step: "04",
    title: "Produce & ship",
    body: "We coordinate production or procurement, quality checks, and worldwide shipping to your door.",
  },
];

export function HowSourcingWorks() {
  return (
    <section className="bg-accent text-white py-20 sm:py-28">
      <Container>
        <div className="mb-14 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading
            eyebrow="Process"
            title="How Product Sourcing Works"
            description="Four clear steps from enquiry to delivery — designed for retailers, brands, and serious buyers."
            tone="on-dark"
          />
          <Button
            href="/sourcing"
            variant="outline"
            size="lg"
            className="shrink-0 self-start border-white/35 text-white hover:border-white hover:bg-white/10 lg:self-auto"
          >
            Start a Request
          </Button>
        </div>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((item) => (
            <div key={item.step}>
              <p className="font-display text-4xl text-white/35">{item.step}</p>
              <h3 className="mt-4 font-display text-2xl">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
