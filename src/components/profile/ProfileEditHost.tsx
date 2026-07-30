"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { StatusEditor } from "@/components/profile/editors/StatusEditor";
import { OpportunityEditor } from "@/components/profile/editors/OpportunityEditor";
import { TravelEditor } from "@/components/profile/editors/TravelEditor";
import { ProfileEditor } from "@/components/profile/editors/ProfileEditor";
import { ListingEditor } from "@/components/profile/editors/ListingEditor";
import type { Member } from "@/lib/types";
import { isStatusActive } from "@/lib/member-status";

type ProfileEditHostProps = {
  member: Member;
};

const EDIT_KEYS = new Set([
  "status",
  "opportunity",
  "travel",
  "profile",
  "listing",
]);

export function ProfileEditHost({ member }: ProfileEditHostProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const edit = searchParams.get("edit");
  const entityId =
    searchParams.get("id") ||
    searchParams.get("listingId") ||
    searchParams.get("opportunityId");

  const close = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("edit");
    next.delete("id");
    next.delete("listingId");
    next.delete("opportunityId");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const openCreateListing = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("edit", "listing");
    next.delete("id");
    next.delete("listingId");
    next.delete("opportunityId");
    const qs = next.toString();
    router.replace(`${pathname}?${qs}`, { scroll: false });
  }, [pathname, router, searchParams]);

  if (!edit || !EDIT_KEYS.has(edit)) return null;

  if (edit === "status") {
    return (
      <StatusEditor
        onClose={close}
        initialText={
          isStatusActive(member.status) ? member.status?.text || "" : ""
        }
      />
    );
  }

  if (edit === "opportunity") {
    const opp =
      member.opportunities?.find((o) => o.id === entityId) ||
      (member.opportunity?.id === entityId ? member.opportunity : null);
    return (
      <OpportunityEditor
        onClose={close}
        opportunityId={entityId}
        defaults={
          opp
            ? {
                description: opp.description,
                city: opp.city,
                country: opp.country,
              }
            : {
                city: member.location.city,
                country: member.location.country,
              }
        }
      />
    );
  }

  if (edit === "travel") {
    return <TravelEditor onClose={close} />;
  }

  if (edit === "profile") {
    return <ProfileEditor onClose={close} />;
  }

  if (edit === "listing") {
    return (
      <ListingEditor
        key={entityId || "new-listing"}
        onClose={close}
        onReturnToCreate={openCreateListing}
        listingId={entityId}
      />
    );
  }

  return null;
}
