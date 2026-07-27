import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { SecondaryButton } from "@/components/ui/SecondaryButton";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "How Source Bridge connects buyers and providers through location, travel, journeys, sourcing requests, and trust.",
};

const sections = [
  {
    title: "Browse Explore",
    body: "Open Explore to discover members by place, service, availability, and journey. Guests can browse freely — no account required to see who is somewhere, or going somewhere.",
  },
  {
    title: "Earn from your location",
    body: "Locals, travellers, and specialists offer help based on where they are or where they’re headed. Join as a provider to list access, journeys, and services others can request.",
  },
  {
    title: "Journeys & travel routes",
    body: "Travellers publish upcoming routes. Buyers find people already moving between cities — carrying, collecting, or checking items along the way.",
  },
  {
    title: "Sourcing & requests",
    body: "Need something specific? Send a sourcing request with place, quantity, budget, and notes. Providers respond when their location or travel makes it possible.",
  },
  {
    title: "Trust & verification",
    body: "Bridge Score, verification badges, reviews, and completed requests help you choose who to work with. Trust grows through real exchanges — not anonymous storefronts.",
  },
  {
    title: "Guests vs account",
    body: "Anyone can browse Explore. Create an account to follow members, message them, and send requests. One shared account can buy, provide, or both.",
  },
  {
    title: "Buyers and providers",
    body: "Buyers find help through people and place. Providers earn by offering local access, inspection, carrying, or specialist knowledge. The network is the people.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="bg-background pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Container className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-electric">
          How it works
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-navy sm:text-5xl">
          People are the bridge.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          Source Bridge connects people through location, travel and local access.
          You don’t shop a warehouse — you find someone who can help from where they
          are, or where they’re going.
        </p>

        <ol className="mt-14 space-y-12">
          {sections.map((section, i) => (
            <li key={section.title}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">
                {String(i + 1).padStart(2, "0")}
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
                {section.title}
              </h2>
              <p className="mt-3 leading-relaxed text-muted">{section.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-14 flex flex-col gap-3 sm:flex-row sm:items-center">
          <PrimaryButton href="/explore">Enter Market</PrimaryButton>
          <SecondaryButton
            href="/join?intent=provider"
            className="border border-border shadow-sm"
          >
            <span className="flex flex-col items-start">
              <span className="text-sm font-bold uppercase tracking-[0.08em]">
                Start Earning
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-80">
                From Your Location
              </span>
            </span>
          </SecondaryButton>
        </div>
      </Container>
    </div>
  );
}
