import { Suspense } from "react";
import { OpportunitiesMarketplaceClient } from "./OpportunitiesMarketplaceClient";

export const dynamic = "force-dynamic";

export default function OpportunitiesPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-app-navy min-h-[100svh] pt-28 text-center text-white/50">
          Loading opportunities…
        </div>
      }
    >
      <OpportunitiesMarketplaceClient />
    </Suspense>
  );
}
