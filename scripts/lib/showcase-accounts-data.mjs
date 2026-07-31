/**
 * Shared showcase demo account definitions for seed + refine scripts.
 * Location and human access come first; products stay secondary.
 */

/** Stable Unsplash craft/market/landscape images — no identifiable people. */
export const IMG = {
  marketMx: "https://images.unsplash.com/photo-1565299502607-1a2d9f2c479f?w=800&q=80",
  silver: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=800&q=80",
  silver2: "https://images.unsplash.com/photo-1611591437281-460bfac5750a?w=800&q=80",
  silver3: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=800&q=80",
  prints: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800&q=80",
  prints2: "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=800&q=80",
  ceramics: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&q=80",
  ceramics2: "https://images.unsplash.com/photo-1610701596007-7619702e5eb6?w=800&q=80",
  ceramics3: "https://images.unsplash.com/photo-1615485507135-2584c4a2d0a6?w=800&q=80",
  cartagena: "https://images.unsplash.com/photo-1583422409516-2895a4d47406?w=800&q=80",
  wayuu: "https://images.unsplash.com/photo-1590874103328-eac6a0965c9f?w=800&q=80",
  wayuu2: "https://images.unsplash.com/photo-1594633312681-425a7b956cc2?w=800&q=80",
  wayuu3: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&q=80",
  crafts: "https://images.unsplash.com/photo-1452860606248-7befbf755d72?w=800&q=80",
  dahab: "https://images.unsplash.com/photo-1539768942893-daf53e448371?w=800&q=80",
  bedouin: "https://images.unsplash.com/photo-1544967882-729677575e28?w=800&q=80",
  bedouin2: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80",
  textile: "https://images.unsplash.com/photo-1558171813-4c088754af7f?w=800&q=80",
  textile2: "https://images.unsplash.com/photo-1520975916094-18a4e7f70842?w=800&q=80",
  redSea: "https://images.unsplash.com/photo-1506905925346-21bda4d134df?w=800&q=80",
  coral: "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=800&q=80",
  shell: "https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=800&q=80",
  oaxaca: "https://images.unsplash.com/photo-1518638150340-f706e86654de?w=800&q=80",
  blackClay: "https://images.unsplash.com/photo-1615485507135-2584c4a2d0a6?w=800&q=80",
  mask: "https://images.unsplash.com/photo-1577083552431-6e5fd01988ec?w=800&q=80",
  mask2: "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=800&q=80",
  chiangmai: "https://images.unsplash.com/photo-1552465011-8e2279070fb4?w=800&q=80",
  thaiTextile: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800&q=80",
  thaiCraft: "https://images.unsplash.com/photo-1606761568499-6d2451b23f66?w=800&q=80",
  loom: "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&q=80",
  thaiMarket: "https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=800&q=80",
};

/**
 * @typedef {{
 *   previousUsernames: string[];
 *   username: string;
 *   name: string;
 *   city: string;
 *   country: string;
 *   bio: string;
 *   publicDisplayMessage: string;
 *   photo: string;
 *   cover: string;
 *   memberType: string;
 *   specialties: string[];
 *   networkCities: Array<{ city: string; country: string }>;
 *   products: Array<{
 *     key: string;
 *     name: string;
 *     description: string;
 *     productKind: "clothing" | "general";
 *     category: string;
 *     subcategory?: string;
 *     images: string[];
 *     sizes?: string[];
 *     price: number;
 *     material?: string;
 *   }>;
 *   statusText: string;
 *   opportunities: Array<{
 *     title: string;
 *     description: string;
 *     city: string;
 *     country: string;
 *     category: string;
 *   }>;
 * }} ShowcaseAccount
 */

/** @type {ShowcaseAccount[]} */
export const SHOWCASE_ACCOUNTS = [
  {
    previousUsernames: ["sb_cdmx"],
    username: "lucia.in.mexico",
    name: "Lucía Mendoza",
    city: "Mexico City",
    country: "Mexico",
    bio: "I split my weeks between Roma Norte and the regional markets outside the city. Happy to check stalls in person, ask makers questions, or collect small pieces when someone can’t travel here.",
    publicDisplayMessage:
      "Based in Mexico City with regular access to regional markets and studios.",
    photo: "/showcase/avatars/lucia-in-mexico.svg",
    cover: IMG.marketMx,
    memberType: "specialist",
    specialties: ["Jewellery", "Home & Living", "Collectibles"],
    networkCities: [
      { city: "Taxco", country: "Mexico" },
      { city: "Puebla", country: "Mexico" },
      { city: "Guadalajara", country: "Mexico" },
    ],
    products: [
      {
        key: "taxco-silver-hoop-set",
        name: "Taxco Sterling Silver Hoop Set",
        description:
          "Hand-forged sterling hoops from a family workshop in Taxco. Brushed finish, lightweight for daily wear.",
        productKind: "general",
        category: "Jewellery",
        subcategory: "Silver",
        images: [IMG.silver, IMG.silver2],
        price: 68,
        material: "Sterling silver",
      },
      {
        key: "studio-ceramic-bowl",
        name: "Studio Glazed Ceramic Bowl",
        description:
          "Wheel-thrown bowl with volcanic-ash glaze from a Roma Norte studio. Food-safe, about 18 cm.",
        productKind: "general",
        category: "Home & Living",
        subcategory: "Kitchen",
        images: [IMG.ceramics, IMG.ceramics2],
        price: 55,
        material: "Stoneware",
      },
    ],
    statusText:
      "Spending the weekend between central markets and the artisan districts. I can inspect or collect small items locally.",
    opportunities: [
      {
        title: "Puebla weekend access",
        description:
          "Travelling to Puebla next weekend and can visit workshops or markets that are awkward to reach online. Happy to photograph or collect by prior arrangement.",
        city: "Mexico City",
        country: "Mexico",
        category: "Travel access",
      },
      {
        title: "Taxco day trip",
        description:
          "Heading to Taxco mid-week and can check silversmiths in person before anyone commits.",
        city: "Taxco",
        country: "Mexico",
        category: "Local inspection",
      },
    ],
  },
  {
    previousUsernames: ["sb_cartagena"],
    username: "valentina.cartagena",
    name: "Valentina Ríos",
    city: "Cartagena",
    country: "Colombia",
    bio: "Coastal resident with family links along the Caribbean. I travel between Cartagena and Spain a few times a year and can help with in-person checks when I’m home.",
    publicDisplayMessage:
      "Travelling between Cartagena and Spain — local access when I’m on the coast.",
    photo: "/showcase/avatars/valentina-cartagena.svg",
    cover: IMG.cartagena,
    memberType: "local",
    specialties: ["Clothing", "Home & Living"],
    networkCities: [
      { city: "Barranquilla", country: "Colombia" },
      { city: "Riohacha", country: "Colombia" },
      { city: "Santa Marta", country: "Colombia" },
    ],
    products: [
      {
        key: "wayuu-medium-mochila",
        name: "Wayuu Medium Mochila Bag",
        description:
          "Single-thread crochet mochila from a Wayuu cooperative in La Guajira. Approx. 28 cm base.",
        productKind: "clothing",
        category: "Traditional clothing",
        images: [IMG.wayuu, IMG.wayuu2],
        sizes: ["Multiple sizes available"],
        price: 95,
        material: "Cotton thread",
      },
      {
        key: "tagua-bead-necklace",
        name: "Tagua Seed Bead Necklace",
        description:
          "Vegetable ivory tagua beads on waxed cord — lightweight tropical piece.",
        productKind: "general",
        category: "Jewellery",
        subcategory: "Necklaces",
        images: [IMG.crafts],
        price: 32,
      },
    ],
    statusText:
      "Flying from Cartagena to Spain next month with room for a few small, legal items.",
    opportunities: [
      {
        title: "Cartagena → Madrid luggage space",
        description:
          "Travelling from Cartagena to Madrid next month with roughly 12–15 kg spare luggage capacity for small legal items by prior arrangement.",
        city: "Cartagena",
        country: "Colombia",
        category: "Travel access",
      },
    ],
  },
  {
    previousUsernames: ["sb_dahab"],
    username: "omar.dahab",
    name: "Omar El-Sayed",
    city: "Dahab",
    country: "Egypt",
    bio: "Based on the Sinai coast and often moving between Dahab, Nuweiba and Saint Catherine. I know the Friday market rhythm and can check stalls when friends abroad need eyes on the ground.",
    publicDisplayMessage:
      "Based in Dahab and often travelling across the Sinai coast.",
    photo: "/showcase/avatars/omar-dahab.svg",
    cover: IMG.dahab,
    memberType: "specialist",
    specialties: ["Jewellery", "Home & Living", "Collectibles"],
    networkCities: [
      { city: "Sharm El-Sheikh", country: "Egypt" },
      { city: "Saint Catherine", country: "Egypt" },
      { city: "Nuweiba", country: "Egypt" },
    ],
    products: [
      {
        key: "bedouin-silver-cuff",
        name: "Bedouin Silver Cuff Bracelet",
        description:
          "Hand-hammered silver cuff with traditional geometric engraving from a Sinai silversmith.",
        productKind: "general",
        category: "Jewellery",
        subcategory: "Bracelets",
        images: [IMG.silver, IMG.silver2],
        price: 72,
        material: "Silver alloy",
      },
      {
        key: "desert-wool-shawl",
        name: "Desert Wool Shawl",
        description:
          "Loosely woven wool shawl in natural cream with indigo border. From a camp near Saint Catherine.",
        productKind: "clothing",
        category: "Traditional clothing",
        images: [IMG.bedouin, IMG.textile],
        sizes: ["Multiple sizes available"],
        price: 58,
        material: "Wool",
      },
    ],
    statusText:
      "Just landed in Dahab. I’ll be around the Friday market and nearby craft stalls this week, and I have spare luggage space for my return journey.",
    opportunities: [
      {
        title: "Ten days in Dahab before Europe",
        description:
          "I’ll be in Dahab for about ten days before returning to Europe. I can inspect, photograph or carry small legal items by prior arrangement.",
        city: "Dahab",
        country: "Egypt",
        category: "Travel access",
      },
      {
        title: "Friday market walk-through",
        description:
          "At the Friday market this week and available to photograph or inspect anything of interest before purchase.",
        city: "Dahab",
        country: "Egypt",
        category: "Local inspection",
      },
    ],
  },
  {
    previousUsernames: ["sb_hurghada"],
    username: "nadia.redsea",
    name: "Nadia Farouk",
    city: "Hurghada",
    country: "Egypt",
    bio: "Red Sea coast resident who regularly drives between Hurghada, Safaga and Cairo. Useful if you need someone local to confirm a workshop, pick up along the route, or send photos before you decide.",
    publicDisplayMessage:
      "Moving between Hurghada, Safaga and Cairo this season.",
    photo: "/showcase/avatars/nadia-redsea.svg",
    cover: IMG.redSea,
    memberType: "local",
    specialties: ["Home & Living", "Jewellery"],
    networkCities: [
      { city: "Safaga", country: "Egypt" },
      { city: "El Gouna", country: "Egypt" },
      { city: "Marsa Alam", country: "Egypt" },
    ],
    products: [
      {
        key: "shell-inlay-tray",
        name: "Mother-of-Pearl Inlay Tray",
        description:
          "Serving tray with mother-of-pearl inlay on acacia wood. 35 × 25 cm.",
        productKind: "general",
        category: "Home & Living",
        subcategory: "Kitchen",
        images: [IMG.shell, IMG.coral],
        price: 64,
        material: "Acacia wood, shell",
      },
      {
        key: "red-sea-glass-bracelet",
        name: "Red Sea Glass Bead Bracelet",
        description:
          "Bracelet with tumbled sea glass collected on Hurghada beaches.",
        productKind: "general",
        category: "Jewellery",
        subcategory: "Bracelets",
        images: [IMG.coral],
        price: 28,
      },
    ],
    statusText:
      "Driving between Hurghada and Safaga over the next few days. I can check local workshops or photograph items before anyone commits.",
    opportunities: [
      {
        title: "Hurghada → Cairo collection run",
        description:
          "Driving from Hurghada to Cairo next week and can collect along the route if timing works.",
        city: "Hurghada",
        country: "Egypt",
        category: "Travel access",
      },
    ],
  },
  {
    previousUsernames: ["sb_oaxaca"],
    username: "mateo.oaxaca",
    name: "Mateo Hernández",
    city: "Oaxaca",
    country: "Mexico",
    bio: "Living in Oaxaca and visiting valley workshops most weekends. I prefer helping people reach makers who don’t sell online rather than running a shop myself.",
    publicDisplayMessage:
      "In Oaxaca this month and visiting workshops outside the usual tourist routes.",
    photo: "/showcase/avatars/mateo-oaxaca.svg",
    cover: IMG.oaxaca,
    memberType: "specialist",
    specialties: ["Home & Living", "Collectibles", "Clothing"],
    networkCities: [
      { city: "San Bartolo Coyotepec", country: "Mexico" },
      { city: "Teotitlán del Valle", country: "Mexico" },
      { city: "Mitla", country: "Mexico" },
    ],
    products: [
      {
        key: "barro-negro-vase",
        name: "Barro Negro Black Clay Vase",
        description:
          "Polished barro negro vase from San Bartolo Coyotepec. About 25 cm tall.",
        productKind: "general",
        category: "Home & Living",
        subcategory: "Decor",
        images: [IMG.blackClay, IMG.ceramics],
        price: 78,
        material: "Black clay",
      },
      {
        key: "zapotec-wool-runner",
        name: "Zapotec Wool Rug Runner",
        description:
          "Hand-woven runner from Teotitlán del Valle with vegetable dyes. 60 × 180 cm.",
        productKind: "general",
        category: "Home & Living",
        subcategory: "Decor",
        images: [IMG.textile, IMG.textile2],
        price: 120,
        material: "Wool",
      },
    ],
    statusText:
      "In Oaxaca until Sunday and visiting a small weaving community outside the centre. Happy to ask questions or check availability in person.",
    opportunities: [
      {
        title: "Valley workshop visits this weekend",
        description:
          "Visiting Oaxaca villages this weekend and available to check workshops that are difficult to contact online.",
        city: "Oaxaca",
        country: "Mexico",
        category: "Local inspection",
      },
    ],
  },
  {
    previousUsernames: ["sb_chiangmai"],
    username: "siriporn.chiangmai",
    name: "Siriporn Wattana",
    city: "Chiang Mai",
    country: "Thailand",
    bio: "Living in Chiang Mai and regularly visiting weaving communities in Lamphun and beyond. Glad to share what I see at markets or help someone understand what’s actually available locally.",
    publicDisplayMessage:
      "Living in Chiang Mai and visiting nearby craft communities.",
    photo: "/showcase/avatars/siriporn-chiangmai.svg",
    cover: IMG.chiangmai,
    memberType: "local",
    specialties: ["Clothing", "Home & Living"],
    networkCities: [
      { city: "Lamphun", country: "Thailand" },
      { city: "Mae Hong Son", country: "Thailand" },
      { city: "Chiang Rai", country: "Thailand" },
    ],
    products: [
      {
        key: "handloom-indigo-scarf",
        name: "Handloom Indigo Cotton Scarf",
        description:
          "Hand-spun cotton scarf with natural indigo from a Lamphun weaver collective.",
        productKind: "clothing",
        category: "Accessories",
        images: [IMG.thaiTextile, IMG.loom],
        sizes: ["Multiple sizes available"],
        price: 44,
        material: "Cotton",
      },
      {
        key: "hill-tribe-embroidered-tote",
        name: "Hill-Tribe Embroidered Tote",
        description:
          "Heavy cotton tote with embroidered panel. Each bag unique.",
        productKind: "clothing",
        category: "Accessories",
        images: [IMG.thaiCraft],
        sizes: ["Multiple sizes available"],
        price: 36,
      },
    ],
    statusText:
      "Near the Lamphun weaving area today and travelling back through Chiang Mai tonight.",
    opportunities: [
      {
        title: "Friday craft market photos",
        description:
          "Spending Friday at a local craft market near Chiang Mai and can provide live photos before purchase.",
        city: "Chiang Mai",
        country: "Thailand",
        category: "Local inspection",
      },
    ],
  },
];

export const SHOWCASE_USERNAMES = SHOWCASE_ACCOUNTS.map((a) => a.username);

export const LEGACY_SHOWCASE_USERNAMES = SHOWCASE_ACCOUNTS.flatMap(
  (a) => a.previousUsernames || [],
);

export const OLD_USERNAME_REDIRECTS = Object.fromEntries(
  SHOWCASE_ACCOUNTS.flatMap((a) =>
    (a.previousUsernames || []).map((old) => [old, a.username]),
  ),
);
