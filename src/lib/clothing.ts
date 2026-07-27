/** Clothing catalogue options — structured for future non-clothing kinds. */

export const CLOTHING_CATEGORIES = [
  "Shirts",
  "T-shirts",
  "Jackets",
  "Coats",
  "Trousers",
  "Jeans",
  "Shorts",
  "Dresses",
  "Skirts",
  "Knitwear",
  "Sportswear",
  "Traditional clothing",
  "Footwear",
  "Accessories",
] as const;

export type ClothingCategory = (typeof CLOTHING_CATEGORIES)[number];

export const CLOTHING_SIZES = [
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "Multiple sizes available",
] as const;

export type ClothingSize = (typeof CLOTHING_SIZES)[number];

export const CLOTHING_CONDITIONS = [
  "New with tags",
  "New without tags",
  "Like new",
  "Good",
  "Fair",
] as const;

export const CLOTHING_FITS = [
  "Slim",
  "Regular",
  "Relaxed",
  "Oversized",
  "Tailored",
] as const;

export const CLOTHING_GENDERS = [
  "Women",
  "Men",
  "Unisex",
  "Kids",
] as const;

export const PRODUCT_KINDS = ["clothing", "general"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
