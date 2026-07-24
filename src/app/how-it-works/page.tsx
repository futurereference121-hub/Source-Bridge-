import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "Find someone near what you need, connect directly, and create value together through location and travel.",
};

const steps = [
  {
    title: "Find someone",
    body: "Open Explore and search by country, city, service, or member. Filters help you spot verified members, people available now, or those travelling soon.",
  },
  {
    title: "Connect directly",
    body: "Follow members you trust. Message them or send a sourcing request when you’re ready. Every listing and journey belongs to a real person.",
  },
  {
    title: "Create value together",
    body: "Locals source and inspect. Travellers carry along a route. Specialists share knowledge. Location becomes access — and access becomes value.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Container className="max-w-3xl">
        <h1 className="font-display text-4xl text-ink sm:text-5xl">How it works</h1>
        <p className="mt-4 text-lg text-muted">
          Source Bridge is a people-powered marketplace. You don’t shop a warehouse —
          you find someone who is somewhere, or going somewhere.
        </p>

        <ol className="mt-12 space-y-10">
          {steps.map((step, i) => (
            <li key={step.title}>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted">
                Step 0{i + 1}
              </p>
              <h2 className="mt-2 font-display text-3xl text-ink">{step.title}</h2>
              <p className="mt-3 leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-14 flex flex-wrap gap-3">
          <Button href="/explore" size="lg">
            Enter Marketplace
          </Button>
          <Button href="/join" variant="outline" size="lg">
            Start Earning From Your Location
          </Button>
        </div>
      </Container>
    </div>
  );
}
