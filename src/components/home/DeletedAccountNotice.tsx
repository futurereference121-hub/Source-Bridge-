"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppUi } from "@/components/providers/AppProviders";

function DeletedAccountNoticeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { showToast } = useAppUi();

  useEffect(() => {
    if (searchParams.get("deleted") !== "1") return;
    showToast("Your Source Bridge account has been deleted.");
    router.replace("/");
  }, [searchParams, showToast, router]);

  return null;
}

/** Shows a one-time toast on the homepage after `/?deleted=1` post-account-deletion redirect. */
export function DeletedAccountNotice() {
  return (
    <Suspense fallback={null}>
      <DeletedAccountNoticeContent />
    </Suspense>
  );
}
