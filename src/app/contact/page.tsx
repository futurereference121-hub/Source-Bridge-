import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ContactForm } from "@/components/forms/ContactForm";
import { siteConfig } from "@/lib/site";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact the Source Bridge community — platform questions, partnership interest, or personal sourcing enquiries.",
};

export default function ContactPage() {
  return (
    <div className="pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Container>
        <SectionHeading
          eyebrow="Contact"
          title="Talk with the Source Bridge community."
          description="Platform questions, community interest, or a sourcing brief — start here. For detailed requests, the personal sourcing form captures quantity, budget, and specifications."
          className="mb-14 max-w-3xl sm:mb-20"
        />

        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="space-y-10">
            <div>
              <h2 className="font-display text-2xl text-ink">Direct</h2>
              <ul className="mt-4 space-y-3 text-sm text-muted">
                <li>
                  <a
                    href={`mailto:${siteConfig.email}`}
                    className="text-navy hover:text-electric"
                  >
                    {siteConfig.email}
                  </a>
                </li>
              </ul>
            </div>

            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              {[
                {
                  title: "Platform",
                  body: "How Source Bridge works, community direction, and partnership interest.",
                },
                {
                  title: "Explore",
                  body: "Questions about finding members, discovery, or Available Finds.",
                },
                {
                  title: "Sourcing",
                  body: "Personal or business sourcing through people with local access.",
                },
              ].map((item) => (
                <div key={item.title} className="border-t border-border pt-4">
                  <h3 className="text-sm font-medium uppercase tracking-[0.14em] text-ink">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted">{item.body}</p>
                </div>
              ))}
            </div>

            <Button href="/sourcing" variant="outline">
              Prefer the full sourcing form?
            </Button>
          </div>

          <ContactForm />
        </div>
      </Container>
    </div>
  );
}
