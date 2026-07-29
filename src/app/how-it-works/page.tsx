import type { Metadata } from "next";
import { HowItWorksStory } from "@/components/how-it-works/HowItWorksStory";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "How Source Bridge connects buyers and providers through location, travel, journeys, sourcing requests, and trust.",
};

export default function HowItWorksPage() {
  return (
    <div className="bg-app-navy text-white">
      <HowItWorksStory />
    </div>
  );
}
