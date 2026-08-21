import type { NavItem } from "@/lib/types";

export const siteConfig = {
  name: "Source Bridge",
  tagline: "If you're somewhere, or you're going somewhere, you can help someone.",
  description: "Unlocking the value of human location.",
  missionLine: "People are the bridge. Location is the value.",
  url: "https://sourcebridge.example",
  email: "info@sourcebridge.com",
  address: "Community locations worldwide",
};

/**
 * Homepage header — text links (auth CTA is rendered separately).
 * Explore belongs in the hero CTA group, not the top-right homepage header.
 */
export const homeNavItems: NavItem[] = [
  { label: "How It Works", href: "/how-it-works" },
];

/** Desktop primary navigation (internal pages) */
export const navItems: NavItem[] = [
  { label: "Explore", href: "/explore" },
  { label: "How It Works", href: "/how-it-works" },
  { label: "Sign In", href: "/sign-in" },
  { label: "Join", href: "/join" },
];

/** Footer / secondary links */
export const footerNavItems: NavItem[] = [
  { label: "Explore", href: "/explore" },
  { label: "How It Works", href: "/how-it-works" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
  { label: "Personal Sourcing", href: "/sourcing" },
  { label: "Join", href: "/join" },
];

export const mobileNavItems: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Search", href: "/search" },
  { label: "Explore", href: "/explore" },
  { label: "Inbox", href: "/inbox" },
  { label: "Profile", href: "/profile" },
];

export const memberTypeLabels: Record<string, string> = {
  local: "Local",
  traveller: "Traveller",
  specialist: "Specialist",
  student: "Student",
  nomad: "Nomad",
  collector: "Collector",
};
