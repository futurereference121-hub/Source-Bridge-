import type { Metadata } from "next";
import { Suspense } from "react";
import { ExploreClient } from "@/app/explore/ExploreClient";
import {
  buildMergedLiveFeed,
  listDirectoryMembersPage,
  DIRECTORY_PAGE_SIZE_MOBILE,
} from "@/lib/members-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Search",
  description:
    "Search Source Bridge members by handle, name, location, or public message.",
};

export default async function SearchPage() {
  const [page, feed] = await Promise.all([
    listDirectoryMembersPage({ page: 1, limit: DIRECTORY_PAGE_SIZE_MOBILE }),
    buildMergedLiveFeed(6),
  ]);

  return (
    <Suspense
      fallback={
        <div className="bg-app-navy min-h-[50vh] pt-28 pb-20 text-center text-sm text-white/50">
          Loading Search…
        </div>
      }
    >
      <ExploreClient
        initialMembers={page.members}
        initialFeed={feed}
        initialTotal={page.total}
        initialHasMore={page.hasMore}
        initialLimit={page.limit}
        searchFirst
      />
    </Suspense>
  );
}
