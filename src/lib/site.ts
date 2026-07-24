import type { NavItem } from "@/lib/types";

export const siteConfig = {
  name: "Source Bridge",
  tagline: "If you're somewhere, or you're going somewhere, you can help someone.",
  description:
    "Source Bridge connects people around the world through trusted local access, personal sourcing, and discoveries shared by members of the community.",
  url: "https://sourcebridge.example",
  email: "hello@sourcebridge.com",
  phone: "+66 2 000 0000",
  address: "First community locations: Thailand · Russia",
};

export const navItems: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Marketplace", href: "/marketplace" },
  { label: "Personal Sourcing", href: "/sourcing" },
  { label: "Categories", href: "/categories" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];
