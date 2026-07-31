"use client";

import Image from "next/image";
import { useState } from "react";
import { memberPhoto, PLACEHOLDER_AVATAR } from "@/lib/placeholders";

type Props = {
  src?: string | null;
  alt: string;
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  className?: string;
  priority?: boolean;
};

/**
 * Profile/avatar image with a layout-safe fallback when the URL fails to load.
 */
export function SafeMemberImage({
  src,
  alt,
  fill,
  width,
  height,
  sizes,
  className,
  priority,
}: Props) {
  const [failed, setFailed] = useState(false);
  const resolved = failed ? PLACEHOLDER_AVATAR : memberPhoto(src);
  const unoptimized =
    resolved.startsWith("data:") ||
    resolved.startsWith("/showcase/") ||
    resolved.startsWith("/uploads/");

  if (fill) {
    return (
      <Image
        src={resolved}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={unoptimized}
        className={className}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <Image
      src={resolved}
      alt={alt}
      width={width ?? 64}
      height={height ?? 64}
      sizes={sizes}
      priority={priority}
      unoptimized={unoptimized}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
