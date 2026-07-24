import type { Listing } from "@/lib/types";

/**
 * Mock marketplace listings. Every listing belongs to a member profile.
 * `supplier` is INTERNAL and must never be shown on the storefront.
 */
export const products: Listing[] = [
  {
    id: "p-001",
    slug: "silk-road-tracksuit",
    name: "Silk Road Tracksuit",
    description:
      "A refined two-piece tracksuit in brushed cotton with contrast piping. Designed for elevated leisure — tailored enough for travel, soft enough for everyday wear.",
    category: "Clothing",
    subcategory: "Tracksuits",
    images: [
      "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=1200&q=80",
      "https://images.unsplash.com/photo-1578587018452-892baca35758?w=1200&q=80",
    ],
    price: 189,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Thailand",
    currentLocation: "Bangkok, Thailand",
    shippingAvailable: true,
    supplier: { code: "TH-ATL-014", region: "Thailand", notes: "Bangkok atelier" },
    availability: "available",
    tags: ["cotton", "leisure", "unisex"],
    featured: true,
    specs: {
      Material: "Brushed cotton blend",
      Fit: "Relaxed tailored",
      Care: "Machine wash cold",
    },
    shippingNote: "Ships within 5–7 business days. International delivery available.",
  },
  {
    id: "p-002",
    slug: "bangkok-evening-kimono",
    name: "Bangkok Evening Kimono",
    description:
      "Hand-finished silk kimono with a fluid drape and subtle tonal embroidery. Ideal as a cover piece or statement layer for evening occasions.",
    category: "Clothing",
    subcategory: "Kimonos",
    images: [
      "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=1200&q=80",
      "https://images.unsplash.com/photo-1564257631407-4deb1f99d992?w=1200&q=80",
    ],
    price: 320,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Thailand",
    currentLocation: "Bangkok, Thailand",
    shippingAvailable: true,
    supplier: { code: "TH-SLK-008", region: "Thailand" },
    availability: "limited",
    tags: ["silk", "evening", "hand-finished"],
    featured: true,
    specs: {
      Material: "100% silk",
      Length: "Midi",
      Origin: "Thailand",
    },
    shippingNote: "Limited quantity. Express shipping on request.",
  },
  {
    id: "p-003",
    slug: "linen-column-dress",
    name: "Linen Column Dress",
    description:
      "A minimal column dress in washed European linen. Clean lines, side slits, and a soft stone wash that improves with wear.",
    category: "Clothing",
    subcategory: "Dresses",
    images: [
      "https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=1200&q=80",
      "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=1200&q=80",
    ],
    price: 245,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Russia",
    currentLocation: "Moscow, Russia",
    shippingAvailable: true,
    supplier: { code: "RU-LN-021", region: "Russia" },
    availability: "available",
    tags: ["linen", "minimal", "summer"],
    featured: true,
    specs: {
      Material: "Washed linen",
      Fit: "Straight column",
      Sizes: "XS–XL",
    },
  },
  {
    id: "p-004",
    slug: "oxford-poplin-shirt",
    name: "Oxford Poplin Shirt",
    description:
      "Crisp poplin shirt with mother-of-pearl buttons and a precise collar. A wardrobe foundation with international sourcing pedigree.",
    category: "Clothing",
    subcategory: "Shirts",
    images: [
      "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=1200&q=80",
      "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=1200&q=80",
    ],
    price: 128,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Thailand",
    currentLocation: "Bangkok, Thailand",
    shippingAvailable: true,
    supplier: { code: "TH-TXT-033", region: "Thailand" },
    availability: "available",
    tags: ["poplin", "essentials", "classic"],
    featured: false,
    specs: {
      Material: "Cotton poplin",
      Collar: "Classic point",
      Care: "Easy iron",
    },
  },
  {
    id: "p-005",
    slug: "wide-leg-wool-pants",
    name: "Wide-Leg Wool Pants",
    description:
      "Fluid wide-leg trousers in lightweight wool crepe. High rise, pressed crease, and a quiet luxury silhouette.",
    category: "Clothing",
    subcategory: "Pants",
    images: [
      "https://images.unsplash.com/photo-1594633313593-bab3825d0caf?w=1200&q=80",
      "https://images.unsplash.com/photo-1506629082955-511b1aa78283?w=1200&q=80",
    ],
    price: 210,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Russia",
    currentLocation: "Moscow, Russia",
    shippingAvailable: true,
    supplier: { code: "RU-WL-017", region: "Russia" },
    availability: "available",
    tags: ["wool", "tailoring", "wide-leg"],
    featured: false,
    specs: {
      Material: "Wool crepe",
      Rise: "High",
      Hem: "Unfinished option",
    },
  },
  {
    id: "p-006",
    slug: "rattan-weekend-bag",
    name: "Rattan Weekend Bag",
    description:
      "Handwoven rattan tote with leather handles and a cotton lining. Structured enough for city days, open enough for coastal weekends.",
    category: "Clothing",
    subcategory: "Bags",
    images: [
      "https://images.unsplash.com/photo-1590874103328-eac38a67478a?w=1200&q=80",
      "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=1200&q=80",
    ],
    price: 165,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Thailand",
    currentLocation: "Bangkok, Thailand",
    shippingAvailable: true,
    supplier: { code: "TH-ART-041", region: "Thailand", notes: "Chiang Mai artisans" },
    availability: "available",
    tags: ["rattan", "handwoven", "leather"],
    featured: true,
    specs: {
      Material: "Rattan & leather",
      Dimensions: "42 × 30 × 18 cm",
      Lining: "Cotton",
    },
  },
  {
    id: "p-007",
    slug: "felted-wool-fedora",
    name: "Felted Wool Fedora",
    description:
      "A classic fedora in dense felted wool with a grosgrain band. Balanced brim and crown for year-round wear.",
    category: "Clothing",
    subcategory: "Hats",
    images: [
      "https://images.unsplash.com/photo-1514327605112-b887c0e61c0a?w=1200&q=80",
      "https://images.unsplash.com/photo-1521369909029-2afed882baee?w=1200&q=80",
    ],
    price: 98,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Russia",
    currentLocation: "Moscow, Russia",
    shippingAvailable: true,
    supplier: { code: "RU-HAT-009", region: "Russia" },
    availability: "available",
    tags: ["wool", "accessories", "classic"],
    featured: false,
    specs: {
      Material: "Felted wool",
      Brim: "6 cm",
      Band: "Grosgrain",
    },
  },
  {
    id: "p-008",
    slug: "hand-knitted-cashmere-scarf",
    name: "Hand-Knitted Cashmere Scarf",
    description:
      "Artisan-knitted cashmere scarf with a soft rib and generous length. Each piece shows subtle variation from the maker’s hand.",
    category: "Clothing",
    subcategory: "Hand Knitted",
    images: [
      "https://images.unsplash.com/photo-1520903920243-00d872a2d1c9?w=1200&q=80",
      "https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=1200&q=80",
    ],
    price: 175,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Russia",
    currentLocation: "Moscow, Russia",
    shippingAvailable: true,
    supplier: { code: "RU-KNT-012", region: "Russia" },
    availability: "made_to_order",
    tags: ["cashmere", "hand-knitted", "artisan"],
    featured: true,
    specs: {
      Material: "Cashmere",
      Dimensions: "200 × 40 cm",
      "Lead time": "2–3 weeks",
    },
    shippingNote: "Made to order. Delivery estimate confirmed after confirmation.",
  },
  {
    id: "p-009",
    slug: "heritage-field-watch",
    name: "Heritage Field Watch",
    description:
      "A clean field watch with a sapphire crystal, leather strap, and understated dial. Built for clarity and longevity.",
    category: "Jewellery",
    subcategory: "Watches",
    images: [
      "https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=1200&q=80",
      "https://images.unsplash.com/photo-1522312346375-d1a52e2b99b3?w=1200&q=80",
    ],
    price: 890,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Russia",
    currentLocation: "Moscow, Russia",
    shippingAvailable: true,
    supplier: { code: "RU-WCH-003", region: "Russia" },
    availability: "limited",
    tags: ["watch", "leather", "sapphire"],
    featured: true,
    specs: {
      Case: "40 mm stainless steel",
      Crystal: "Sapphire",
      "Water resistance": "50 m",
    },
  },
  {
    id: "p-010",
    slug: "hammered-silver-cuff",
    name: "Hammered Silver Cuff",
    description:
      "Solid sterling silver cuff with a hand-hammered surface. Substantial weight, open fit, and a quiet reflective finish.",
    category: "Jewellery",
    subcategory: "Silver",
    images: [
      "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=1200&q=80",
      "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=1200&q=80",
    ],
    price: 245,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Thailand",
    currentLocation: "Bangkok, Thailand",
    shippingAvailable: true,
    supplier: { code: "TH-SLV-019", region: "Thailand" },
    availability: "available",
    tags: ["sterling", "handmade", "cuff"],
    featured: false,
    specs: {
      Material: "925 sterling silver",
      Width: "2.5 cm",
      Finish: "Hammered",
    },
  },
  {
    id: "p-011",
    slug: "imperial-era-brooch",
    name: "Imperial-Era Brooch",
    description:
      "Antique-inspired brooch with filigree detailing and aged gold tone. A collectible accent with historical character.",
    category: "Jewellery",
    subcategory: "Antiques",
    images: [
      "https://images.unsplash.com/photo-1601121141461-9d6647bca1ed?w=1200&q=80",
      "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=1200&q=80",
    ],
    price: 420,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Russia",
    currentLocation: "Moscow, Russia",
    shippingAvailable: true,
    supplier: { code: "RU-ANT-006", region: "Russia" },
    availability: "limited",
    tags: ["antique", "filigree", "collectible"],
    featured: false,
    specs: {
      "Era style": "Early 20th century",
      Metal: "Gold-plated brass",
      Condition: "Excellent vintage",
    },
  },
  {
    id: "p-012",
    slug: "pearl-strand-necklace",
    name: "Pearl Strand Necklace",
    description:
      "A classic strand of cultured pearls with a discreet clasp. Timeless proportion for day or evening.",
    category: "Jewellery",
    subcategory: "Necklaces",
    images: [
      "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=1200&q=80",
      "https://images.unsplash.com/photo-1599643477877-530eb83abc8e?w=1200&q=80",
    ],
    price: 380,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Thailand",
    currentLocation: "Bangkok, Thailand",
    shippingAvailable: true,
    supplier: { code: "TH-PRL-011", region: "Thailand" },
    availability: "available",
    tags: ["pearls", "classic", "gift"],
    featured: true,
    specs: {
      "Pearl size": "7–8 mm",
      Length: "45 cm",
      Clasp: "Sterling silver",
    },
  },
  {
    id: "p-013",
    slug: "woven-leather-bracelet",
    name: "Woven Leather Bracelet",
    description:
      "Braided leather bracelet with a brushed metal clasp. Slim profile, durable construction, and warm patina over time.",
    category: "Jewellery",
    subcategory: "Bracelets",
    images: [
      "https://images.unsplash.com/photo-1611652022419-a9419f74343d?w=1200&q=80",
      "https://images.unsplash.com/photo-1573408301185-9146fe634ad0?w=1200&q=80",
    ],
    price: 72,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Thailand",
    currentLocation: "Bangkok, Thailand",
    shippingAvailable: true,
    supplier: { code: "TH-LTH-027", region: "Thailand" },
    availability: "available",
    tags: ["leather", "everyday", "unisex"],
    featured: false,
    specs: {
      Material: "Vegetable-tanned leather",
      Width: "1.2 cm",
      Closure: "Metal clasp",
    },
  },
  {
    id: "p-014",
    slug: "signet-ring-onyx",
    name: "Onyx Signet Ring",
    description:
      "A modern signet with a polished onyx face set in sterling silver. Clean geometry for daily wear.",
    category: "Jewellery",
    subcategory: "Rings",
    images: [
      "https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=1200&q=80",
      "https://images.unsplash.com/photo-1603561596112-0a132b757442?w=1200&q=80",
    ],
    price: 195,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Russia",
    currentLocation: "Moscow, Russia",
    shippingAvailable: true,
    supplier: { code: "RU-RNG-015", region: "Russia" },
    availability: "available",
    tags: ["onyx", "signet", "sterling"],
    featured: false,
    specs: {
      Stone: "Black onyx",
      Band: "Sterling silver",
      Sizing: "Made to size on request",
    },
  },
  {
    id: "p-015",
    slug: "ceramic-vessel-set",
    name: "Ceramic Vessel Set",
    description:
      "Three hand-thrown ceramic vessels in complementary glazes. Designed for floral arranging or quiet tabletop presence.",
    category: "Home & Living",
    subcategory: "Decor",
    images: [
      "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?w=1200&q=80",
      "https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=1200&q=80",
    ],
    price: 210,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Thailand",
    currentLocation: "Bangkok, Thailand",
    shippingAvailable: true,
    supplier: { code: "TH-CRM-022", region: "Thailand" },
    availability: "available",
    tags: ["ceramic", "handmade", "set"],
    featured: true,
    specs: {
      Pieces: "Set of 3",
      Finish: "Matte glaze",
      Care: "Hand wash",
    },
  },
  {
    id: "p-016",
    slug: "teak-serving-board",
    name: "Teak Serving Board",
    description:
      "Solid teak serving board with a live edge and food-safe oil finish. Substantial presence for entertaining.",
    category: "Home & Living",
    subcategory: "Kitchen",
    images: [
      "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1200&q=80",
      "https://images.unsplash.com/photo-1590794056226-79ef3a8147e1?w=1200&q=80",
    ],
    price: 145,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Thailand",
    currentLocation: "Bangkok, Thailand",
    shippingAvailable: true,
    supplier: { code: "TH-WD-018", region: "Thailand" },
    availability: "available",
    tags: ["teak", "kitchen", "serving"],
    featured: false,
    specs: {
      Material: "Solid teak",
      Dimensions: "45 × 28 cm",
      Finish: "Food-safe oil",
    },
  },
  {
    id: "p-017",
    slug: "low-profile-lounge-chair",
    name: "Low-Profile Lounge Chair",
    description:
      "A sculptural lounge chair with a bentwood frame and linen upholstery. Compact footprint, generous comfort.",
    category: "Home & Living",
    subcategory: "Furniture",
    images: [
      "https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=1200&q=80",
      "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&q=80",
    ],
    price: 1280,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Russia",
    currentLocation: "Moscow, Russia",
    shippingAvailable: true,
    supplier: { code: "RU-FRN-004", region: "Russia" },
    availability: "made_to_order",
    tags: ["furniture", "lounge", "linen"],
    featured: true,
    specs: {
      Frame: "Bentwood",
      Upholstery: "Linen",
      "Lead time": "4–6 weeks",
    },
    shippingNote: "Freight shipping quoted per destination.",
  },
  {
    id: "p-018",
    slug: "handloom-wall-hanging",
    name: "Handloom Wall Hanging",
    description:
      "Textile wall hanging woven on a traditional loom with natural dyes. Soft geometry and tactile depth for interiors.",
    category: "Home & Living",
    subcategory: "Crafts",
    images: [
      "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&q=80",
      "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1200&q=80",
    ],
    price: 265,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Thailand",
    currentLocation: "Bangkok, Thailand",
    shippingAvailable: true,
    supplier: { code: "TH-TXT-044", region: "Thailand" },
    availability: "limited",
    tags: ["textile", "handloom", "natural dye"],
    featured: false,
    specs: {
      Technique: "Handloom weave",
      Dyes: "Natural",
      Dimensions: "80 × 120 cm",
    },
  },
  {
    id: "p-019",
    slug: "porcelain-figurine-antique",
    name: "Porcelain Figurine",
    description:
      "Carefully sourced porcelain figurine with delicate hand-painted detail. A collectible piece with verified condition notes.",
    category: "Collectibles",
    subcategory: "Antiques",
    images: [
      "https://images.unsplash.com/photo-1577083552431-6e5fd01988ec?w=1200&q=80",
      "https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=1200&q=80",
    ],
    price: 540,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Russia",
    currentLocation: "Moscow, Russia",
    shippingAvailable: true,
    supplier: { code: "RU-COL-002", region: "Russia" },
    availability: "limited",
    tags: ["porcelain", "antique", "figurine"],
    featured: true,
    specs: {
      Material: "Porcelain",
      Condition: "Very good",
      Height: "22 cm",
    },
  },
  {
    id: "p-020",
    slug: "amber-specimen-display",
    name: "Amber Specimen Display",
    description:
      "Natural amber specimen mounted for display. Warm translucence and organic form — a rare find for collectors.",
    category: "Collectibles",
    subcategory: "Rare Finds",
    images: [
      "https://images.unsplash.com/photo-1617038260897-41a1f14a8ca0?w=1200&q=80",
      "https://images.unsplash.com/photo-1515377905703-c4788e51af15?w=1200&q=80",
    ],
    price: 680,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Russia",
    currentLocation: "Moscow, Russia",
    shippingAvailable: true,
    supplier: { code: "RU-AMB-001", region: "Russia" },
    availability: "limited",
    tags: ["amber", "specimen", "display"],
    featured: true,
    specs: {
      Type: "Natural amber",
      Mount: "Display stand included",
      Certificate: "Available on request",
    },
  },
  {
    id: "p-021",
    slug: "limited-edition-print-set",
    name: "Limited Edition Print Set",
    description:
      "Numbered set of three archival prints from a contemporary series. Issued in a limited run with signed certificates.",
    category: "Collectibles",
    subcategory: "Limited Items",
    images: [
      "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=1200&q=80",
      "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=1200&q=80",
    ],
    price: 390,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "International",
    currentLocation: "Bangkok, Thailand",
    shippingAvailable: true,
    supplier: { code: "OTH-ART-007", region: "Other" },
    availability: "to_source",
    tags: ["print", "limited", "signed"],
    featured: false,
    specs: {
      Edition: "1 of 50",
      Medium: "Archival pigment print",
      Size: "40 × 50 cm each",
    },
    shippingNote: "Preorder — ships when edition is released.",
  },
  {
    id: "p-022",
    slug: "thai-silk-evening-clutch",
    name: "Thai Silk Evening Clutch",
    description:
      "Compact evening clutch in handwoven Thai silk with a concealed magnetic closure. Luminous weave in deep ink.",
    category: "Clothing",
    subcategory: "Bags",
    images: [
      "https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?w=1200&q=80",
      "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=1200&q=80",
    ],
    price: 155,
    currency: "USD",
    memberId: "m-niran-chai",
    country: "Thailand",
    currentLocation: "Bangkok, Thailand",
    shippingAvailable: true,
    supplier: { code: "TH-SLK-051", region: "Thailand" },
    availability: "available",
    tags: ["silk", "evening", "clutch"],
    featured: false,
    specs: {
      Material: "Handwoven Thai silk",
      Closure: "Magnetic",
      Lining: "Satin",
    },
  },
];

export function getProductBySlug(slug: string): Listing | undefined {
  return products.find((p) => p.slug === slug);
}

export function getFeaturedProducts(limit = 6): Listing[] {
  return products.filter((p) => p.featured).slice(0, limit);
}

export function getProductsByMember(memberId: string): Listing[] {
  return products.filter((p) => p.memberId === memberId);
}

/** Prefer member.listingIds so seed data stays consistent across owners. */
export function getListingsForMember(member: {
  id: string;
  listingIds: string[];
}): Listing[] {
  const ids = new Set(member.listingIds);
  const fromIds = products.filter((p) => ids.has(p.id));
  if (fromIds.length) return fromIds;
  return getProductsByMember(member.id);
}

export function getRelatedProducts(product: Listing, limit = 4): Listing[] {
  return products
    .filter(
      (p) =>
        p.id !== product.id &&
        (p.category === product.category ||
          p.subcategory === product.subcategory),
    )
    .slice(0, limit);
}

export function getProductsByCategory(category?: string, subcategory?: string): Listing[] {
  return products.filter((p) => {
    if (category && p.category.toLowerCase() !== category.toLowerCase()) {
      return false;
    }
    if (
      subcategory &&
      (p.subcategory?.toLowerCase() ?? "") !== subcategory.toLowerCase()
    ) {
      return false;
    }
    return true;
  });
}

export function getUniqueCategories(): string[] {
  return [...new Set(products.map((p) => p.category))];
}

export function getSubcategoriesForCategory(category: string): string[] {
  return [
    ...new Set(
      products
        .filter((p) => p.category.toLowerCase() === category.toLowerCase())
        .map((p) => p.subcategory)
        .filter((s): s is string => Boolean(s)),
    ),
  ];
}

export function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(price);
  } catch {
    return `${currency} ${price}`;
  }
}

export function availabilityLabel(availability: Listing["availability"]): string {
  const labels: Record<Listing["availability"], string> = {
    available: "Available",
    limited: "Limited",
    made_to_order: "Made to order",
    to_source: "Available to source",
  };
  return labels[availability];
}

/** Alias exports for listing-first naming. */
export const listings = products;
export const getListingBySlug = getProductBySlug;
export const getFeaturedListings = getFeaturedProducts;
export const getListingsByMember = getProductsByMember;
export const getRelatedListings = getRelatedProducts;

