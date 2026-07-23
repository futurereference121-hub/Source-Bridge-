import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";

const steps = [
  {
    step: "01",
    title: "Share what you need",
    body: "Tell us the product, quantity, budget, and destination. A clear brief helps the right people respond.",
  },
  {
    step: "02",
    title: "Connect through people",
    body: "We activate members and trusted networks — specialists, locals, and travellers with real access where it matters.",
  },
  {
    step: "03",
    title: "Refine together",
    body: "Review options, samples, and timing. Human judgment shapes quality until the fit feels right.",
  },
  {
    step: "04",
    title: "Deliver across borders",
    body: "Members coordinate sourcing and shipping pathways — from local pickup to worldwide delivery.",
  },
];

export function HowSourcingWorks() {
  return (
    <section className="bg-accent text-white py-20 sm:py-28">
      <Container>
        <div className="mb-14 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading
            eyebrow="Process"
            title="How Personal Sourcing Works"
            description="Sourcing through real people — four clear steps from brief to delivery."
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
