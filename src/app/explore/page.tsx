import type { Metadata } from "next";
import { Suspense } from "react";
import { ExploreClient } from "./ExploreClient";
import {
  buildMergedLiveFeed,
  getAllMembers,
} from "@/lib/members-service";

export const metadata: Metadata = {
  title: "Explore",
  description:
    "Find people by place, travel, and what they can help with on Source Bridge.",
};

export default async function ExplorePage() {
  const members = await getAllMembers();
  const feed = await buildMergedLiveFeed(8, members);

  return (
    <Suspense
      fallback={
        <div className="bg-app-navy min-h-[50vh] pt-28 pb-20 text-center text-sm text-white/50">
          Loading Explore…
        </div>
      }
    >
      <ExploreClient initialMembers={members} initialFeed={feed} />
    </Suspense>
  );
}
