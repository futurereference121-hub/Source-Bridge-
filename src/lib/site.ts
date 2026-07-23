import type { NavItem } from "@/lib/types";

export const siteConfig = {
  name: "Source Bridge",
  tagline: "Retail Excellence. Global Product Sourcing.",
  description:
    "International product sourcing and curated retail connecting Thailand, Russia, and the world.",
  url: "https://sourcebridge.example",
  email: "hello@sourcebridge.com",
  phone: "+66 2 000 0000",
  address: "Bangkok · Moscow · Worldwide",
};

export const navItems: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Shop", href: "/shop" },
  { label: "Product Sourcing", href: "/sourcing" },
  { label: "Categories", href: "/categories" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];
