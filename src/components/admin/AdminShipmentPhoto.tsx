"use client";

import { ViewPhotoControl } from "@/components/media/ViewPhotoControl";

/** Thumbnail + VIEW PHOTO lightbox for admin Protected Payment cards. */
export function AdminShipmentPhoto({
  url,
  testId = "admin-shipment-photo",
}: {
  url: string;
  testId?: string;
}) {
  return (
    <ViewPhotoControl
      url={url}
      alt="Shipping proof"
      testId={testId}
      caption="Shipping proof"
    />
  );
}
