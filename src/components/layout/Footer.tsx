import Link from "next/link";
import { footerNavItems, siteConfig } from "@/lib/site";
import { Container } from "@/components/ui/Container";
import { SourceBridgeLogo } from "@/components/brand/SourceBridgeLogo";

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-navy text-white">
      <Container className="py-14 sm:py-16">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <SourceBridgeLogo size={32} color="white" withWordmark />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/65">
              {siteConfig.description}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-white/45">
              Navigate
            </p>
            <ul className="mt-5 space-y-3">
              {footerNavItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-white/75 transition-colors hover:text-white"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-white/45">
              Contact
            </p>
            <ul className="mt-5 space-y-3 text-sm text-white/75">
              <li>
                <a href={`mailto:${siteConfig.email}`} className="hover:text-white">
                  {siteConfig.email}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-8 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {siteConfig.name}. All rights reserved.
          </p>
          <p>People · Place · Trusted access</p>
        </div>
      </Container>
    </footer>
  );
}
