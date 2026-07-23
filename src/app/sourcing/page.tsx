import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SourcingForm } from "@/components/forms/SourcingForm";
import {
  Factory,
  Globe,
  Hammer,
  Package,
  Ship,
  ShoppingBag,
  Store,
  Users,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Product Sourcing",
  description:
    "Wholesale, retail, custom manufacturing, factory and artisan sourcing, procurement, import, and worldwide shipping with Source Bridge.",
};

const services = [
  {
    icon: Package,
    title: "Wholesale sourcing",
    body: "Volume programs with reliable lead times and consistent quality.",
  },
  {
    icon: Store,
    title: "Retail-ready goods",
    body: "Curated products prepared for boutique and multi-brand floors.",
  },
  {
    icon: Factory,
    title: "Custom manufacturing",
    body: "Develop private-label and made-to-spec products with partner factories.",
  },
  {
    icon: Hammer,
    title: "Factory & artisan",
    body: "Access industrial capacity and small-batch artisan workshops.",
  },
  {
    icon: ShoppingBag,
    title: "Procurement",
    body: "Structured buying across categories with transparent commercial terms.",
  },
  {
    icon: Ship,
    title: "Import coordination",
    body: "Documentation guidance and consolidation for cross-border shipments.",
  },
  {
    icon: Globe,
    title: "Worldwide shipping",
    body: "Door-to-door logistics planning from origin to your destination.",
  },
  {
    icon: Users,
    title: "Dedicated support",
    body: "A single sourcing desk from brief through delivery confirmation.",
  },
];

export default function SourcingPage() {
  return (
    <div className="pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Container>
        <SectionHeading
          eyebrow="Product Sourcing"
          title="From brief to delivery — sourcing built for professionals."
          description="Source Bridge activates networks across Thailand and Russia for wholesale, retail, custom manufacturing, and specialist procurement."
          className="mb-14 max-w-3xl sm:mb-20"
        />

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((service) => (
            <div key={service.title} className="border border-border bg-surface p-6">
              <service.icon className="text-accent" size={22} strokeWidth={1.5} />
              <h3 className="mt-5 font-display text-2xl text-ink">{service.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{service.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-20 grid gap-12 lg:mt-28 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading
              eyebrow="Request"
              title="Tell us what you need."
              description="Share as much detail as you can. We’ll respond with next steps, timelines, and sourcing options."
            />
            <ul className="mt-8 space-y-3 text-sm text-muted">
              <li>— Thailand & Russia focus, expandable globally</li>
              <li>— Samples, MOQs, and factory introductions</li>
              <li>— Retail buyers and wholesale partners welcome</li>
            </ul>
          </div>
          <SourcingForm />
        </div>
      </Container>
    </div>
  );
}
