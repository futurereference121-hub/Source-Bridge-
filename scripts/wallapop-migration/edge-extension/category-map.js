/**
 * Category mapping for the Edge extension (mirrors lib/category-map.mjs).
 * Exposed as global WallapopCategoryMap for content-script.js.
 */
(function (global) {
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
      match: [/deporte/i, /sportswear/i, /chandal/i, /tracksuit/i],
    },
    {
      productKind: "clothing",
      category: "Accessories",
      subcategory: "Bags",
      match: [/bolsos?/i, /mochilas?/i, /bags?/i, /handbags?/i, /carteras?/i],
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
      match: [/accesorios?/i, /accessories/i, /cinturones?/i, /bufandas?/i],
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
      match: [/relojes?/i, /watches?/i],
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
      match: [/collares?/i, /necklaces?/i],
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
      match: [/plata/i, /silver/i, /joyas?/i, /jewellery/i, /jewelry/i],
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
      match: [/hogar/i, /decoraci[oó]n/i, /home/i, /decor/i],
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

  function mapWallapopCategory(item) {
    const hay = [item.category, item.subcategory, item.title]
      .filter(Boolean)
      .join(" | ");

    for (const rule of RULES) {
      if (rule.match.some((re) => re.test(hay))) {
        return {
          ok: true,
          confidence: "high",
          productKind: rule.productKind,
          category: rule.category,
          subcategory: rule.subcategory || "",
          reason: `Matched Source Bridge ${rule.category}`,
        };
      }
    }

    return {
      ok: false,
      confidence: "none",
      status: "REVIEW_REQUIRED",
      reason: `No confident Source Bridge category for Wallapop "${hay || "(empty)"}"`,
    };
  }

  global.WallapopCategoryMap = { mapWallapopCategory };
})(typeof self !== "undefined" ? self : globalThis);
