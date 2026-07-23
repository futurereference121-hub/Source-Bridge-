import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SourcingForm } from "@/components/forms/SourcingForm";
import {
  Briefcase,
  Globe,
  Handshake,
  MapPinned,
  Package,
  Plane,
  Ship,
  Users,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Product Sourcing",
  description:
    "Personal and business sourcing through real people — specialists, locals, and travellers connected by Source Bridge.",
};

const services = [
  {
    icon: Users,
    title: "Through real people",
    body: "Specialists, locals, and travellers with genuine access — not anonymous stock lists.",
  },
  {
    icon: MapPinned,
    title: "Where they are",
    body: "Thailand and Russia are our first community locations — more regions as members join.",
  },
  {
    icon: Package,
    title: "Personal sourcing",
    body: "Find a specific piece, gift, or hard-to-reach product through someone on the ground.",
  },
  {
    icon: Briefcase,
    title: "Business sourcing",
    body: "Wholesale, private-label, and procurement programs shaped with member expertise.",
  },
  {
    icon: Handshake,
    title: "Human connection",
    body: "Clarity, judgment, and accountability — the qualities that make cross-border buying work.",
  },
  {
    icon: Plane,
    title: "Traveller-ready (soon)",
    body: "Trip-aware sourcing and travel calendars will fit this model — placeholders for now.",
  },
  {
    icon: Ship,
    title: "Shipping pathways",
    body: "From local handoff to worldwide delivery, coordinated through the member who sources.",
  },
  {
    icon: Globe,
    title: "Community growth",
    body: "One founding member today. The same profile structure welcomes the next members.",
  },
];

export default function SourcingPage() {
  return (
    <div className="pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Container>
        <SectionHeading
          eyebrow="Product Sourcing"
          title="Sourced through people — not warehouses."
          description="Personal and business sourcing via members of the community: specialists, locals, and travellers who can help because of where they are — or where they're going."
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
              description="Share as much detail as you can. We'll connect your brief with the right human access — starting with our Thailand and Russia community."
            />
            <ul className="mt-8 space-y-3 text-sm text-muted">
              <li>— People-powered sourcing, not company inventory</li>
              <li>— First community locations: Thailand &amp; Russia</li>
              <li>— Personal requests and business programs welcome</li>
            </ul>
          </div>
          <SourcingForm />
        </div>
      </Container>
    </div>
  );
}
