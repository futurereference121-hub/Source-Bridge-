import { redirect } from "next/navigation";

/** Marketplace catalogue retired — Explore is the people directory. */
export default function MarketplaceRedirectPage() {
  redirect("/explore");
}
