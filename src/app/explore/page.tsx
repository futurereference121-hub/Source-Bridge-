import type { Metadata } from "next";
import { ExploreClient } from "./ExploreClient";

export const metadata: Metadata = {
  title: "Explore",
  description:
    "Who can help you, and where? Browse Source Bridge members by location, travel, and service.",
};

export default function ExplorePage() {
  return <ExploreClient />;
}
