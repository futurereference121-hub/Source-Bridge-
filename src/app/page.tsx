import type { Metadata } from "next";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Home",
  description: siteConfig.description,
};

const steps = [
  {
    title: "Find someone",
    copy: "Search by place, service, or who can help — locals, travellers, and specialists.",
  },
  {
    title: "Connect directly",
    copy: "Follow members, message them, and request help based on where they are or where they’re going.",
  },
  {
    title: "Create value together",
    copy: "Source, inspect, carry, or share local access — people are the bridge.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="relative min-h-[88svh] w-full overflow-hidden bg-ink">
        <Image
          src="https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1800&q=80"
          alt="People connecting across places"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center animate-fade-in"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink/85 via-ink/55 to-ink/30" />

        <div className="relative z-10 mx-auto flex min-h-[88svh] max-w-7xl flex-col justify-end px-5 pb-14 pt-28 sm:px-8 sm:pb-16 lg:px-10 lg:pb-20">
          <p className="animate-fade-up font-display text-2xl tracking-[0.12em] text-white sm:text-3xl">
            {siteConfig.name.toUpperCase()}
          </p>
          <h1 className="animate-fade-up animate-delay-1 mt-5 max-w-3xl font-display text-3xl leading-[1.15] text-white sm:text-5xl md:text-[3.25rem]">
            {siteConfig.tagline}
          </h1>
          <p className="animate-fade-up animate-delay-2 mt-5 max-w-lg text-base leading-relaxed text-white/80 sm:text-lg">
            {siteConfig.description}
          </p>
          <div className="animate-fade-up animate-delay-3 mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              href="/explore"
              variant="primary"
              size="lg"
              className="bg-white text-ink hover:bg-stone"
            >
              Enter Marketplace
            </Button>
            <Button
              href="/join"
              variant="outline"
              size="lg"
              className="border-white/40 text-white hover:border-white hover:bg-white/10"
            >
              Start Earning From Your Location
            </Button>
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <Container>
          <div className="grid gap-10 sm:grid-cols-3 sm:gap-8">
            {steps.map((step, i) => (
              <div key={step.title}>
                <p className="text-[11px] uppercase tracking-[0.2em] text-muted">
                  0{i + 1}
                </p>
                <h2 className="mt-3 font-display text-2xl text-ink sm:text-3xl">
                  {step.title}
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted">{step.copy}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-border py-12 sm:py-14">
        <Container>
          <p className="text-center font-display text-2xl text-ink sm:text-3xl">
            {siteConfig.missionLine}
          </p>
        </Container>
      </section>
    </>
  );
}
