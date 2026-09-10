"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TrustPassportTier } from "@/lib/trust-passport/types";
import { trustPassportAuthReturnPath } from "@/lib/trust-passport/auth-return";
import { TrustPassportShield } from "@/components/trust/TrustPassportShield";
import { TrustPassportPanel } from "@/components/trust/TrustPassportPanel";
import { useAppUi } from "@/components/providers/AppProviders";

type TrustPassportHostProps = {
  memberSlug: string;
  memberId: string;
  username: string;
  displayName: string;
  photo: string;
  isOwner: boolean;
  publicTier: TrustPassportTier;
  size?: "sm" | "md";
};

/**
 * Shield + auth-gated Trust Passport panel.
 * Full detail loads only after authentication; scroll position preserved (no reload).
 */
export function TrustPassportHost({
  memberSlug,
  memberId: _memberId,
  username,
  displayName,
  photo,
  isOwner,
  publicTier,
  size = "md",
}: TrustPassportHostProps) {
  void _memberId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { account, requireAuth } = useAppUi();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    if (searchParams.get("passport") === "1") {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("passport");
      const qs = next.toString();
      router.replace(
        qs ? `/members/${memberSlug}?${qs}` : `/members/${memberSlug}`,
        { scroll: false },
      );
    }
  }, [memberSlug, router, searchParams]);

  const openPassport = useCallback(() => {
    const returnPath = trustPassportAuthReturnPath(
      memberSlug,
      `/members/${memberSlug}`,
    );
    if (
      !requireAuth(
        "view Trust Passport information",
        returnPath,
      )
    ) {
      return;
    }
    setOpen(true);
  }, [memberSlug, requireAuth]);

  useEffect(() => {
    if (searchParams.get("passport") !== "1") return;
    if (!account) return;
    setOpen(true);
  }, [account, searchParams]);

  return (
    <>
      <TrustPassportShield
        tier={publicTier}
        size={size}
        onOpen={openPassport}
      />
      <TrustPassportPanel
        open={open}
        onClose={close}
        memberSlug={memberSlug}
        isOwner={isOwner}
        publicTier={publicTier}
        profile={{
          photo,
          displayName,
          username,
          slug: memberSlug,
        }}
      />
    </>
  );
}
