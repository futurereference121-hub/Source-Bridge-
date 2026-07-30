/**
 * Map Wallapop category text → Source Bridge categories.
 * Only uses existing SB categories; uncertain items go to review.
 */

export const SB_TOP_LEVEL = [
  "Clothing",
  "Jewellery",
  "Home & Living",
  "Collectibles",
];

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
];

const RULES = [
  {
    productKind: "clothing",
    category: "Footwear",
    subcategory: "",
    match: [/zapatos?/i, /calzado/i, /zapatillas?/i, /botas?/i, /shoes?/i, /boots?/i, /sneakers?/i, /footwear/i],
  },
  {
    productKind: "clothing",
    category: "Dresses",
    subcategory: "Dresses",
    match: [/vestidos?/i, /dresses?/i],
  },
  {
    productKind: "clothing",
    category: "Skirts",
    subcategory: "",
    match: [/faldas?/i, /skirts?/i],
  },
  {
    productKind: "clothing",
    category: "Jeans",
    subcategory: "Pants",
    match: [/jeans?/i, /vaqueros?/i],
  },
  {
    productKind: "clothing",
    category: "Trousers",
    subcategory: "Pants",
    match: [/pantalones?/i, /trousers?/i, /pants?/i],
  },
  {
    productKind: "clothing",
    category: "Shorts",
    subcategory: "",
    match: [/shorts?/i, /bermudas?/i],
  },
  {
    productKind: "clothing",
    category: "Jackets",
    subcategory: "",
    match: [/chaquetas?/i, /jackets?/i, /cazadoras?/i],
  },
  {
    productKind: "clothing",
    category: "Coats",
    subcategory: "",
    match: [/abrigos?/i, /coats?/i, /parkas?/i],
  },
  {
    productKind: "clothing",
    category: "T-shirts",
    subcategory: "Shirts",
    match: [/camisetas?/i, /t-?shirts?/i],
  },
  {
    productKind: "clothing",
    category: "Shirts",
    subcategory: "Shirts",
    match: [/camisas?/i, /shirts?/i, /blusas?/i],
  },
  {
    productKind: "clothing",
    category: "Knitwear",
    subcategory: "Hand Knitted",
    match: [/jerseys?/i, /punto/i, /knitwear/i, /sudaderas?/i, /hoodies?/i],
  },
  {
    productKind: "clothing",
    category: "Sportswear",
    subcategory: "Tracksuits",
    match: [
      /deporte/i,
      /sportswear/i,
      /ch[aá]ndal(?:es)?/i,
      /tracksuit/i,
      /neopreno/i,
      /\bbody\b/i,
    ],
  },
  {
    productKind: "clothing",
    category: "Accessories",
    subcategory: "Bags",
    match: [
      /bolsos?/i,
      /bolsas?/i,
      /mochilas?/i,
      /bags?/i,
      /handbags?/i,
      /carteras?/i,
    ],
  },
  {
    productKind: "clothing",
    category: "Accessories",
    subcategory: "Hats",
    match: [/sombreros?/i, /gorras?/i, /hats?/i, /caps?/i],
  },
  {
    productKind: "clothing",
    category: "Accessories",
    subcategory: "",
    match: [
      /accesorios?/i,
      /accessories/i,
      /cinturones?/i,
      /bufandas?/i,
      /scarf|scarfs|scarves|pa[nñ]uelo/i,
    ],
  },
  {
    productKind: "clothing",
    category: "Traditional clothing",
    subcategory: "Kimonos",
    match: [/kimonos?/i, /tradicional/i],
  },
  {
    productKind: "general",
    category: "Jewellery",
    subcategory: "Watches",
    match: [/reloj(?:es)?/i, /watches?/i, /g-?shock/i],
  },
  {
    productKind: "general",
    category: "Jewellery",
    subcategory: "Rings",
    match: [/anillos?/i, /rings?/i],
  },
  {
    productKind: "general",
    category: "Jewellery",
    subcategory: "Necklaces",
    match: [/collar(?:es)?/i, /necklaces?/i],
  },
  {
    productKind: "general",
    category: "Jewellery",
    subcategory: "Bracelets",
    match: [/pulseras?/i, /bracelets?/i],
  },
  {
    productKind: "general",
    category: "Jewellery",
    subcategory: "Silver",
    match: [
      /plata/i,
      /silver/i,
      /joyas?/i,
      /joyer[ií]a/i,
      /jewellery/i,
      /jewelry/i,
    ],
  },
  {
    productKind: "general",
    category: "Home & Living",
    subcategory: "Furniture",
    match: [/muebles?/i, /furniture/i],
  },
  {
    productKind: "general",
    category: "Home & Living",
    subcategory: "Kitchen",
    match: [/cocina/i, /kitchen/i],
  },
  {
    productKind: "general",
    category: "Home & Living",
    subcategory: "Decor",
    match: [
      /hogar/i,
      /decoraci[oó]n/i,
      /home/i,
      /decor/i,
      /alfombra/i,
      /rug/i,
      /carpet/i,
    ],
  },
  {
    productKind: "general",
    category: "Collectibles",
    subcategory: "Antiques",
    match: [/antig[uü]edades?/i, /antiques?/i, /coleccionismo/i, /collectibles?/i],
  },
  {
    productKind: "clothing",
    category: "Accessories",
    subcategory: "",
    match: [/moda/i, /fashion/i, /ropa/i, /clothing/i, /apparel/i],
  },
];

/**
 * @param {{ category?: string, subcategory?: string, title?: string }} item
 * @returns {{ ok: true, productKind: string, category: string, subcategory: string } | { ok: false, reason: string }}
 */
export function mapWallapopCategory(item) {
  const hay = [item.category, item.subcategory, item.title]
    .filter(Boolean)
    .join(" | ");

  for (const rule of RULES) {
    if (rule.match.some((re) => re.test(hay))) {
      return {
        ok: true,
        productKind: rule.productKind,
        category: rule.category,
        subcategory: rule.subcategory || "",
      };
    }
  }

  return {
    ok: false,
    reason: `No confident Source Bridge category for Wallapop "${hay || "(empty)"}"`,
  };
}

export function mapCondition(raw) {
  const t = String(raw || "").toLowerCase();
  if (/nuevo con etiquetas|new with tags/.test(t)) return "New with tags";
  if (/nuevo sin etiquetas|new without tags/.test(t)) return "New without tags";
  if (/como nuevo|like new/.test(t)) return "Like new";
  if (/buen estado|good/.test(t)) return "Good";
  if (/aceptable|fair|usado|used/.test(t)) return "Fair";
  return raw ? String(raw).slice(0, 80) : "";
}
