import Link from "next/link";
import { navItems, siteConfig } from "@/lib/site";
import { Container } from "@/components/ui/Container";

export function Footer() {
  return (
    <footer className="border-t border-border bg-ink text-white">
      <Container className="py-16 sm:py-20">
        <div className="grid gap-12 md:grid-cols-3">
          <div>
            <p className="font-display text-2xl tracking-[0.08em]">
              {siteConfig.name.toUpperCase()}
            </p>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/65">
              A people-powered platform for trusted local access. If you&apos;re
              somewhere — or going somewhere — you can help someone.
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-white/45">
              Navigate
            </p>
            <ul className="mt-5 space-y-3">
              {navItems.map((item) => (
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
              <li>{siteConfig.phone}</li>
              <li>{siteConfig.address}</li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-white/10 pt-8 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {siteConfig.name}. All rights reserved.</p>
          <p>People · Place · Trusted access</p>
        </div>
      </Container>
    </footer>
  );
}
