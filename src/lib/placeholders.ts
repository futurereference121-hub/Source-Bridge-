/** Local SVG placeholders for empty real accounts (no fake photos). */
export const PLACEHOLDER_AVATAR = "/uploads/placeholders/avatar.svg";
export const PLACEHOLDER_COVER = "/uploads/placeholders/cover.svg";
export const PLACEHOLDER_PRODUCT = "/uploads/placeholders/product.svg";

export function memberPhoto(url?: string | null): string {
  return url && url.trim() ? url : PLACEHOLDER_AVATAR;
}

export function memberCover(url?: string | null): string {
  return url && url.trim() ? url : PLACEHOLDER_COVER;
}
