/**
 * Controlled suggestion map: location key → category hints.
 * Never invent claims at runtime — only surface keys present here.
 * Keys are lowercase city or country names / codes.
 */
export const locationCategorySuggestions: Record<string, readonly string[]> = {
  marrakech: ["leather goods", "textiles", "artisan crafts"],
  morocco: ["leather goods", "textiles", "ceramics", "spices"],
  bangkok: ["silk", "street fashion", "handicrafts", "jewellery"],
  thailand: ["silk", "handicrafts", "ceramics"],
  tokyo: ["watches", "vintage electronics", "streetwear", "stationery"],
  japan: ["watches", "ceramics", "vintage", "knives"],
  paris: ["fashion", "antiques", "perfume", "design objects"],
  france: ["fashion", "antiques", "wine accessories"],
  moscow: ["antiques", "mid-century design", "books"],
  russia: ["antiques", "design objects"],
  istanbul: ["leather", "textiles", "fashion samples"],
  turkey: ["leather", "textiles", "ceramics"],
  jaipur: ["jewellery", "gemstones", "silverwork", "textiles"],
  india: ["jewellery", "textiles", "handicrafts"],
  "mexico city": ["ceramics", "crafts", "contemporary design"],
  mexico: ["ceramics", "textiles", "crafts"],
  oaxaca: ["ceramics", "textiles"],
  london: ["rare books", "prints", "estate finds"],
  colombia: ["coffee", "crafts"],
  bogota: ["coffee", "crafts"],
};

export function getLocationSuggestions(
  city?: string,
  country?: string,
  cityCode?: string,
  countryCode?: string,
): string[] {
  const keys = [cityCode, city, countryCode, country]
    .filter(Boolean)
    .map((k) => k!.trim().toLowerCase());

  const found = new Set<string>();
  for (const key of keys) {
    const hits = locationCategorySuggestions[key];
    if (hits) hits.forEach((h) => found.add(h));
  }
  return Array.from(found);
}
