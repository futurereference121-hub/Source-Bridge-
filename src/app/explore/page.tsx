import type { Metadata } from "next";
import { Suspense } from "react";
import { ExploreClient } from "./ExploreClient";
import {
  buildMergedLiveFeed,
  listDirectoryMembersPage,
  DIRECTORY_PAGE_SIZE_MOBILE,
} from "@/lib/members-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Explore",
  description:
    "Find people by place, travel, and what they can help with on Source Bridge.",
};

export default async function ExplorePage() {
  const [page, feed] = await Promise.all([
    listDirectoryMembersPage({ page: 1, limit: DIRECTORY_PAGE_SIZE_MOBILE }),
    buildMergedLiveFeed(8),
  ]);

  return (
    <Suspense
      fallback={
        <div className="bg-app-navy min-h-[50vh] pt-28 pb-20 text-center text-sm text-white/50">
          Loading Explore…
        </div>
      }
    >
      <ExploreClient
        initialMembers={page.members}
        initialFeed={feed}
        initialTotal={page.total}
        initialHasMore={page.hasMore}
        initialLimit={page.limit}
      />
    </Suspense>
  );
}
