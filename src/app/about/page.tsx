import type { Metadata } from "next";
import Image from "next/image";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "About",
  description:
    "Source Bridge philosophy — trade became too impersonal. People trust people. Technology connects rather than replaces. People are the bridge.",
};

export default function AboutPage() {
  return (
    <div className="pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20 lg:items-end">
          <SectionHeading
            eyebrow="About"
            title="People are the bridge."
            description="Modern trade became too impersonal. Source Bridge exists so people can trust people again — with technology that connects rather than replaces."
          />
          <p className="text-base leading-relaxed text-muted sm:text-lg">
            If you&apos;re somewhere, or you&apos;re going somewhere, you can help
            someone. Location is value. Members share discoveries and sourcing
            access from where they are — starting with our first community
            locations in Thailand and Russia.
          </p>
        </div>

        <div className="relative mt-16 aspect-[16/9] overflow-hidden bg-stone sm:mt-20">
          <Image
            src="https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=1600&q=80"
            alt="People connecting across cultures and places"
            fill
            sizes="100vw"
            className="object-cover"
            priority
          />
        </div>

        <div className="mt-16 grid gap-12 sm:mt-24 lg:grid-cols-3">
          {[
            {
              title: "Trade grew distant",
              body: "Buying and sourcing often lost the human face — endless catalogues without trust, context, or care.",
            },
            {
              title: "People trust people",
              body: "We rebuild connection around equal member profiles: presence, local knowledge, and accountability earned over time.",
            },
            {
              title: "Tech connects, not replaces",
              body: "Platforms should amplify human bridges — messaging, travel context, and community tools will grow here without replacing the people.",
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
            <h2 className="font-display text-3xl text-ink">Join the bridge</h2>
            <p className="mt-2 max-w-xl text-muted">
              Explore member findings or request personal sourcing through people
              who are already where you need them.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button href="/marketplace" size="lg">
              Explore Marketplace
            </Button>
            <Button href="/sourcing" variant="outline" size="lg">
              Request Sourcing
            </Button>
          </div>
        </div>
      </Container>
    </div>
  );
}
