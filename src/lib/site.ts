import type { NavItem } from "@/lib/types";

export const siteConfig = {
  name: "Source Bridge",
  tagline: "People are the bridge. Location is the value.",
  description:
    "Source Bridge connects people around the world through trusted local access, personal sourcing, and products shared by members of the community.",
  url: "https://sourcebridge.example",
  email: "hello@sourcebridge.com",
  phone: "+66 2 000 0000",
  address: "Thailand · Russia · Worldwide",
};

export const navItems: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Marketplace", href: "/marketplace" },
  { label: "Product Sourcing", href: "/sourcing" },
  { label: "Categories", href: "/categories" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];
