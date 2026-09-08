"use client";

import { GetTheAppButton } from "@/components/pwa/GetTheAppButton";

/** Compact Explore-page install cue — keeps ExploreClient free of install logic forks. */
export function ExploreGetTheApp() {
  return (
    <div className="mb-5 flex justify-center sm:mb-6 sm:justify-end">
      <GetTheAppButton variant="explore" />
    </div>
  );
}
