import type { Metadata } from "next";
import Image from "next/image";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "About",
  description:
    "Learn about Source Bridge — international product sourcing and curated retail connecting Thailand, Russia, and the world.",
};

export default function AboutPage() {
  return (
    <div className="pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20 lg:items-end">
          <SectionHeading
            eyebrow="About"
            title="Built for trust across borders."
            description="Source Bridge is an international product sourcing and retail company. Our network focuses on Thailand and Russia — with a foundation designed to grow into additional markets."
          />
          <p className="text-base leading-relaxed text-muted sm:text-lg">
            We believe the best retail experiences start with disciplined sourcing:
            clear briefs, careful maker relationships, and presentation that respects
            both craft and commerce.
          </p>
        </div>

        <div className="relative mt-16 aspect-[16/9] overflow-hidden bg-stone sm:mt-20">
          <Image
            src="https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=1600&q=80"
            alt="Quiet retail space with natural light"
            fill
            sizes="100vw"
            className="object-cover"
            priority
          />
        </div>

        <div className="mt-16 grid gap-12 sm:mt-24 lg:grid-cols-3">
          {[
            {
              title: "Sourcing first",
              body: "We start with the supply chain — factories, artisans, and wholesalers — then shape assortments for retail excellence.",
            },
            {
              title: "Two hubs, global reach",
              body: "Thailand and Russia form our core corridors today. Logistics and partnerships extend delivery worldwide.",
            },
            {
              title: "Ready to scale",
              body: "Our catalogue, category model, and sourcing workflows are structured so new regions can be added cleanly.",
            },
          ].map((item) => (
            <div key={item.title} className="border-t border-border pt-6">
              <h3 className="font-display text-2xl text-ink">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{item.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-20 flex flex-col gap-4 border border-border bg-surface p-8 sm:mt-28 sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div>
            <h2 className="font-display text-3xl text-ink">Partner with Source Bridge</h2>
            <p className="mt-2 max-w-xl text-muted">
              Whether you need inventory for your store or a full sourcing program, we’re
              ready to talk.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button href="/sourcing" size="lg">
              Request Sourcing
            </Button>
            <Button href="/contact" variant="outline" size="lg">
              Contact Us
            </Button>
          </div>
        </div>
      </Container>
    </div>
  );
}
