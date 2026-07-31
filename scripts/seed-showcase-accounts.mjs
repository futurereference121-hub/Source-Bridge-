/**
 * Idempotent showcase demo accounts for Source Bridge Explore.
 *
 * Dry-run by default — pass --confirm to write.
 *
 * Usage:
 *   npm run seed:showcase
 *   npm run seed:showcase -- --confirm
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const DRY_RUN = !args.has("--confirm");

const DEMO_PASSWORD = "Showcase!Demo2026";
const SHOWCASE_ATTRS = { source: "showcase", isDemo: true };
const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plain, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

function cleanListingSlug(raw) {
  return String(raw || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function listingSlugFor(username, productKey) {
  return cleanListingSlug(`showcase-${username}-${productKey}`);
}

function showcaseEmail(username) {
  return `showcase+${username}@sourcebridge.demo`;
}

function attrsJson(productKey) {
  return JSON.stringify({ ...SHOWCASE_ATTRS, showcaseKey: productKey });
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** Stable Unsplash craft/market/landscape images — no identifiable people. */
const IMG = {
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
  oaxaca: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&q=80",
  blackClay: "https://images.unsplash.com/photo-1615485507135-2584c4a2d0a6?w=800&q=80",
  mask: "https://images.unsplash.com/photo-1577083552431-6e5fd01988ec?w=800&q=80",
  mask2: "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=800&q=80",
  chiangmai: "https://images.unsplash.com/photo-1552465011-8e2279070fb4?w=800&q=80",
  thaiTextile: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800&q=80",
  thaiCraft: "https://images.unsplash.com/photo-1606761568499-6d2451b23f66?w=800&q=80",
  loom: "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&q=80",
  thaiMarket: "https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=800&q=80",
};

/** @type {Array<{
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
 *   opportunity: {
 *     title: string;
 *     description: string;
 *     city: string;
 *     country: string;
 *     category: string;
 *   };
 * }>} */
const SHOWCASE_ACCOUNTS = [
  {
    username: "sb_cdmx",
    name: "Lucía Mendoza",
    city: "Mexico City",
    country: "Mexico",
    bio: "Independent curator connecting CDMX artisans with international buyers. Specialising in Taxco silver, limited-run prints, and studio ceramics from local makers.",
    publicDisplayMessage: "Sourcing handmade silver, prints & ceramics across Mexico City this week.",
    photo: IMG.marketMx,
    cover: IMG.silver3,
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
          "Hand-forged sterling hoops from a family workshop in Taxco. Brushed finish, lightweight for daily wear. Each pair stamped .925.",
        productKind: "general",
        category: "Jewellery",
        subcategory: "Silver",
        images: [IMG.silver, IMG.silver2, IMG.silver3],
        price: 68,
        material: "Sterling silver",
      },
      {
        key: "cdmx-lino-print",
        name: "CDMX Linocut Market Print",
        description:
          "Limited edition linocut on cotton rag paper depicting the Mercado de Jamaica flower stalls. Signed and numbered, 30 × 40 cm.",
        productKind: "general",
        category: "Home & Living",
        subcategory: "Decor",
        images: [IMG.prints, IMG.prints2],
        price: 42,
      },
      {
        key: "studio-ceramic-bowl",
        name: "Studio Glazed Ceramic Bowl",
        description:
          "Wheel-thrown bowl with volcanic-ash glaze from a Roma Norte studio. Food-safe, dishwasher-friendly, ~18 cm diameter.",
        productKind: "general",
        category: "Home & Living",
        subcategory: "Kitchen",
        images: [IMG.ceramics, IMG.ceramics2, IMG.ceramics3],
        price: 55,
        material: "Stoneware",
      },
    ],
    statusText:
      "Back from Taxco with fresh silver samples — message me if you want photos before the weekend market.",
    opportunity: {
      title: "Taxco silver wholesale lot",
      description:
        "Looking for a buyer interested in a curated lot of 20–30 Taxco silver pieces (rings, cuffs, pendants). Maker-direct pricing, can arrange insured shipping from CDMX.",
      city: "Mexico City",
      country: "Mexico",
      category: "Jewellery",
    },
  },
  {
    username: "sb_cartagena",
    name: "Valentina Ríos",
    city: "Cartagena",
    country: "Colombia",
    bio: "Coastal sourcer working with Wayuu weavers and Caribbean craft cooperatives. I photograph every piece in natural light and share maker stories with buyers.",
    publicDisplayMessage: "Fresh Wayuu mochilas & coastal crafts — sourcing around Cartagena & La Guajira.",
    photo: IMG.cartagena,
    cover: IMG.wayuu,
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
          "Single-thread crochet mochila from a certified Wayuu cooperative in La Guajira. Geometric pattern in indigo, sand, and coral. Approx. 28 cm base.",
        productKind: "clothing",
        category: "Traditional clothing",
        images: [IMG.wayuu, IMG.wayuu2, IMG.wayuu3],
        sizes: ["Multiple sizes available"],
        price: 95,
        material: "Cotton thread",
      },
      {
        key: "caribbean-straw-clutch",
        name: "Caribbean Woven Straw Clutch",
        description:
          "Palm-leaf clutch with leather strap, woven in the Bolívar countryside. Lined interior, fits phone and essentials.",
        productKind: "clothing",
        category: "Accessories",
        images: [IMG.crafts, IMG.wayuu2],
        sizes: ["Multiple sizes available"],
        price: 38,
      },
      {
        key: "tagua-bead-necklace",
        name: "Tagua Seed Bead Necklace",
        description:
          "Vegetable ivory tagua beads strung on waxed cord — lightweight tropical statement piece. Natural dye, adjustable length.",
        productKind: "general",
        category: "Jewellery",
        subcategory: "Necklaces",
        images: [IMG.crafts, IMG.wayuu],
        price: 32,
      },
      {
        key: "coastal-table-runner",
        name: "Coastal Cotton Table Runner",
        description:
          "Hand-blocked cotton runner with Caribbean botanical motifs. 45 × 180 cm, colour-fast natural dyes.",
        productKind: "general",
        category: "Home & Living",
        subcategory: "Decor",
        images: [IMG.textile, IMG.textile2],
        price: 48,
      },
    ],
    statusText:
      "Visiting a Wayuu cooperative tomorrow — can add custom colour requests to this week's order.",
    opportunity: {
      title: "Wayuu bag consignment",
      description:
        "Seeking a boutique or online shop to consign 15 medium Wayuu mochilas with full maker attribution. MOQ flexible, photos and stories included.",
      city: "Cartagena",
      country: "Colombia",
      category: "Clothing",
    },
  },
  {
    username: "sb_dahab",
    name: "Omar El-Sayed",
    city: "Dahab",
    country: "Egypt",
    bio: "Bedouin craft liaison on the Sinai coast. I work with desert camps and Red Sea villages to source jewellery, textiles, and ceremonial pieces for ethical buyers.",
    publicDisplayMessage: "Bedouin crafts & Sinai textiles — based in Dahab, travelling the peninsula.",
    photo: IMG.dahab,
    cover: IMG.bedouin,
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
          "Hand-hammered silver cuff with traditional geometric engraving from a Sinai silversmith. Adjustable open back, approx. 6 cm wide.",
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
          "Loosely woven wool shawl in natural cream with indigo border stripe. Woven on a ground loom in a Bedouin camp near Saint Catherine.",
        productKind: "clothing",
        category: "Traditional clothing",
        images: [IMG.bedouin, IMG.bedouin2, IMG.textile],
        sizes: ["Multiple sizes available"],
        price: 58,
        material: "Wool",
      },
      {
        key: "sinai-incense-set",
        name: "Sinai Herb Incense Set",
        description:
          "Bundle of desert herbs and frankincense resin with a hand-carved holder. Sourced from foragers in the South Sinai mountains.",
        productKind: "general",
        category: "Home & Living",
        subcategory: "Decor",
        images: [IMG.crafts, IMG.dahab],
        price: 24,
      },
    ],
    statusText:
      "Heading to Saint Catherine this week — can photograph new textile lots for interested buyers.",
    opportunity: {
      title: "Sinai textile collection",
      description:
        "Offering a curated set of 8–12 Bedouin textiles (shawls, runners, wall hangings) for a gallery or interior buyer. Provenance notes included.",
      city: "Dahab",
      country: "Egypt",
      category: "Home & Living",
    },
  },
  {
    username: "sb_hurghada",
    name: "Nadia Farouk",
    city: "Hurghada",
    country: "Egypt",
    bio: "Red Sea coast sourcer focusing on coral-safe crafts, shell inlay work, and nautical-inspired home pieces from Hurghada artisans.",
    publicDisplayMessage: "Red Sea crafts & coastal home pieces — Hurghada & Safaga network.",
    photo: IMG.redSea,
    cover: IMG.coral,
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
          "Rectangular serving tray with mother-of-pearl inlay on acacia wood. Finished with food-safe lacquer, 35 × 25 cm.",
        productKind: "general",
        category: "Home & Living",
        subcategory: "Kitchen",
        images: [IMG.shell, IMG.coral, IMG.crafts],
        price: 64,
        material: "Acacia wood, shell",
      },
      {
        key: "red-sea-glass-bracelet",
        name: "Red Sea Glass Bead Bracelet",
        description:
          "Bracelet strung with tumbled sea glass collected on Hurghada beaches, paired with silver-plated spacers. Stretch fit.",
        productKind: "general",
        category: "Jewellery",
        subcategory: "Bracelets",
        images: [IMG.coral, IMG.shell],
        price: 28,
      },
      {
        key: "nautical-rope-basket",
        name: "Nautical Rope Storage Basket",
        description:
          "Coiled rope basket with leather handles — workshop-made in Hurghada marina district. Approx. 30 cm diameter.",
        productKind: "general",
        category: "Home & Living",
        subcategory: "Decor",
        images: [IMG.crafts, IMG.redSea],
        price: 36,
      },
    ],
    statusText:
      "New shell-inlay samples from Safaga workshop — happy to share close-ups before you commit.",
    opportunity: {
      title: "Coastal home décor bundle",
      description:
        "Looking for a hotel or boutique buyer interested in a mixed lot of Red Sea home pieces (trays, baskets, wall hooks). Can deliver to Hurghada port.",
      city: "Hurghada",
      country: "Egypt",
      category: "Home & Living",
    },
  },
  {
    username: "sb_oaxaca",
    name: "Mateo Hernández",
    city: "Oaxaca",
    country: "Mexico",
    bio: "Oaxaca-based maker liaison for barro negro pottery, backstrap-loom textiles, and carved alebrije masks. I document every piece with the artisan's name.",
    publicDisplayMessage: "Black clay, textiles & masks from Oaxaca valleys — studio visits by appointment.",
    photo: IMG.oaxaca,
    cover: IMG.blackClay,
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
          "Polished barro negro vase from San Bartolo Coyotepec. Smoke-fired finish, narrow neck, ~25 cm tall. Signed on base.",
        productKind: "general",
        category: "Home & Living",
        subcategory: "Decor",
        images: [IMG.blackClay, IMG.ceramics, IMG.ceramics2],
        price: 78,
        material: "Black clay",
      },
      {
        key: "zapotec-wool-runner",
        name: "Zapotec Wool Rug Runner",
        description:
          "Hand-woven runner from Teotitlán del Valle with diamond motif in cochineal red and indigo. 60 × 180 cm, vegetable dyes.",
        productKind: "general",
        category: "Home & Living",
        subcategory: "Decor",
        images: [IMG.textile, IMG.textile2, IMG.bedouin2],
        price: 120,
        material: "Wool",
      },
      {
        key: "carved-wooden-mask",
        name: "Carved Wooden Festival Mask",
        description:
          "Copal wood mask carved and painted in a Oaxaca City workshop. Wall-mount ready, approx. 30 cm height. Decorative use.",
        productKind: "general",
        category: "Collectibles",
        subcategory: "Antiques",
        images: [IMG.mask, IMG.mask2],
        price: 85,
      },
      {
        key: "rebozo-cotton-shawl",
        name: "Hand-Fringed Cotton Rebozo",
        description:
          "Traditional rebozo with hand-knotted fringe. Lightweight cotton for daily wear or display. Multiple colourways available.",
        productKind: "clothing",
        category: "Traditional clothing",
        images: [IMG.textile, IMG.oaxaca],
        sizes: ["Multiple sizes available"],
        price: 52,
      },
    ],
    statusText:
      "Barro negro kiln firing this Friday — reserve pieces now for photos straight from the workshop.",
    opportunity: {
      title: "Oaxaca pottery pre-order",
      description:
        "Taking pre-orders for a barro negro tableware set (6 plates + 6 bowls) from Coyotepec. Lead time ~3 weeks, insured export packing available.",
      city: "Oaxaca",
      country: "Mexico",
      category: "Home & Living",
    },
  },
  {
    username: "sb_chiangmai",
    name: "Siriporn Wattana",
    city: "Chiang Mai",
    country: "Thailand",
    bio: "Northern Thailand textile sourcer working with hill-tribe cooperatives and night-market makers. Focus on natural dyes, handloom cotton, and small-batch crafts.",
    publicDisplayMessage: "Handloom textiles & hill-tribe crafts — Chiang Mai & Lamphun this month.",
    photo: IMG.chiangmai,
    cover: IMG.thaiTextile,
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
          "Hand-spun cotton scarf with natural indigo dip-dye from a Lamphun weaver collective. Soft finish, 180 × 45 cm.",
        productKind: "clothing",
        category: "Accessories",
        images: [IMG.thaiTextile, IMG.loom, IMG.textile],
        sizes: ["Multiple sizes available"],
        price: 44,
        material: "Cotton",
      },
      {
        key: "hill-tribe-embroidered-tote",
        name: "Hill-Tribe Embroidered Tote",
        description:
          "Heavy cotton tote with Hmong-style embroidery panel. Reinforced handles, interior pocket. Each bag unique.",
        productKind: "clothing",
        category: "Accessories",
        images: [IMG.thaiCraft, IMG.wayuu2],
        sizes: ["Multiple sizes available"],
        price: 36,
      },
      {
        key: "lantern-paper-set",
        name: "Handmade Mulberry Paper Set",
        description:
          "Set of 12 sheets mulberry paper with pressed botanicals — ideal for journaling or gift wrap. Chiang Mai craft village.",
        productKind: "general",
        category: "Home & Living",
        subcategory: "Decor",
        images: [IMG.prints, IMG.thaiCraft],
        price: 22,
      },
    ],
    statusText:
      "At the Lamphun weaver collective today — can add custom lengths for scarf orders.",
    opportunity: {
      title: "Northern Thailand textile lot",
      description:
        "Offering a mixed lot of 10–15 handloom pieces (scarves, table runners, wall hangings) for a fair-trade retailer. Full cooperative attribution.",
      city: "Chiang Mai",
      country: "Thailand",
      category: "Clothing",
    },
  },
];

const SHOWCASE_USERNAMES = SHOWCASE_ACCOUNTS.map((a) => a.username);

function showcaseUserWhere() {
  return {
    isDemo: true,
    OR: [
      { username: { in: SHOWCASE_USERNAMES } },
      { email: { endsWith: "@sourcebridge.demo" } },
    ],
  };
}

async function countShowcaseEntities(userIds) {
  if (!userIds.length) {
    return {
      users: 0,
      listings: 0,
      listingImages: 0,
      statuses: 0,
      opportunities: 0,
      networkLocations: 0,
    };
  }
  const [listings, listingImages, statuses, opportunities, networkLocations] =
    await Promise.all([
      prisma.stockListing.count({ where: { userId: { in: userIds } } }),
      prisma.listingImage.count({
        where: { listing: { userId: { in: userIds } } },
      }),
      prisma.statusUpdate.count({ where: { userId: { in: userIds } } }),
      prisma.opportunity.count({ where: { userId: { in: userIds } } }),
      prisma.networkLocation.count({ where: { userId: { in: userIds } } }),
    ]);
  return {
    users: userIds.length,
    listings,
    listingImages,
    statuses,
    opportunities,
    networkLocations,
  };
}

function printCounts(label, counts) {
  console.log(
    `${label}: users=${counts.users} listings=${counts.listings} images=${counts.listingImages} statuses=${counts.statuses} opportunities=${counts.opportunities} network=${counts.networkLocations}`,
  );
}

async function upsertShowcaseUser(account, passwordHash) {
  const email = showcaseEmail(account.username);
  const userData = {
    email,
    name: account.name,
    username: account.username,
    slug: account.username,
    photo: account.photo,
    cover: account.cover,
    bio: account.bio,
    publicDisplayMessage: account.publicDisplayMessage,
    city: account.city,
    country: account.country,
    memberType: account.memberType,
    intent: "both",
    specialties: JSON.stringify(account.specialties),
    emailVerified: true,
    onboardingComplete: true,
    identityVerified: false,
    identityVerificationStatus: "UNVERIFIED",
    isDiscoverable: true,
    isTestAccount: false,
    isDemo: true,
    isAdmin: false,
    role: "USER",
    passwordHash,
    mustChangePassword: false,
    profileVideoUrl: "",
    profileVideoPosterUrl: "",
    profileVideoPathname: "",
    profileVideoPosterPathname: "",
    profileVideoMime: "",
    profileVideoDurationSec: null,
    profileVideoCaption: "",
    profileVideoUpdatedAt: null,
  };

  const existing = await prisma.user.findUnique({
    where: { username: account.username },
  });

  if (existing) {
    if (!existing.isDemo && !existing.email.endsWith("@sourcebridge.demo")) {
      throw new Error(
        `Refusing to update non-demo user @${account.username} (${existing.email})`,
      );
    }
    return prisma.user.update({
      where: { id: existing.id },
      data: userData,
    });
  }

  return prisma.user.create({ data: userData });
}

async function syncNetworkLocations(userId, cities) {
  await prisma.networkLocation.deleteMany({ where: { userId } });
  for (const [sortOrder, loc] of cities.entries()) {
    await prisma.networkLocation.create({
      data: {
        userId,
        city: loc.city,
        country: loc.country,
        sortOrder,
      },
    });
  }
}

async function findShowcaseListing(userId, account, product) {
  const slug = listingSlugFor(account.username, product.key);
  const bySlug = await prisma.stockListing.findUnique({ where: { slug } });
  if (bySlug?.userId === userId) return bySlug;

  const rows = await prisma.stockListing.findMany({
    where: { userId },
    select: { id: true, slug: true, name: true, attributes: true, userId: true },
  });

  return (
    rows.find((row) => {
      if (row.name !== product.name) return false;
      try {
        const attrs = JSON.parse(row.attributes || "{}");
        return attrs.source === "showcase" && attrs.showcaseKey === product.key;
      } catch {
        return false;
      }
    }) ?? null
  );
}

async function upsertListing(userId, account, product) {
  const slug = listingSlugFor(account.username, product.key);
  const images = [...new Set((product.images || []).filter(Boolean))];
  const shipLabel = `${account.city}, ${account.country}`;
  const listingData = {
    name: product.name,
    slug,
    description: product.description,
    productKind: product.productKind,
    category: product.category,
    subcategory: product.subcategory || "",
    images: JSON.stringify(images),
    sizes: JSON.stringify(product.sizes || []),
    quantity: product.productKind === "general" ? "Available" : "",
    material: product.material || "",
    availability: "available",
    saleStatus: "AVAILABLE",
    location: shipLabel,
    shipFromCity: account.city,
    shipFromCountry: account.country,
    shippingAvailable: true,
    price: product.price,
    currency: "USD",
    attributes: attrsJson(product.key),
  };

  const existing = await findShowcaseListing(userId, account, product);

  if (existing) {
    await prisma.$transaction(async (tx) => {
      await tx.stockListing.update({
        where: { id: existing.id },
        data: { ...listingData, userId },
      });
      await tx.listingImage.deleteMany({ where: { listingId: existing.id } });
      for (const [sortOrder, url] of images.entries()) {
        await tx.listingImage.create({
          data: {
            listingId: existing.id,
            url,
            sortOrder,
            isCover: sortOrder === 0,
          },
        });
      }
    });
    return { action: "updated", slug: existing.slug };
  }

  const created = await prisma.$transaction(async (tx) => {
    return tx.stockListing.create({
      data: {
        userId,
        ...listingData,
        listingImages: {
          create: images.map((url, sortOrder) => ({
            url,
            sortOrder,
            isCover: sortOrder === 0,
          })),
        },
      },
    });
  });
  return { action: "created", slug: created.slug };
}

async function refreshStatus(userId, text) {
  const now = new Date();
  await prisma.statusUpdate.deleteMany({ where: { userId } });
  await prisma.statusUpdate.create({
    data: {
      userId,
      text,
      postedAt: now,
      expiresAt: new Date(now.getTime() + STATUS_TTL_MS),
    },
  });
}

async function refreshOpportunity(userId, account, opp) {
  const existing = await prisma.opportunity.findFirst({
    where: { userId, title: opp.title },
  });
  const now = new Date();
  const data = {
    title: opp.title,
    description: opp.description,
    city: opp.city,
    country: opp.country,
    category: opp.category,
    postedAt: now,
    expiresAt: daysFromNow(30),
    startsAt: hoursFromNow(24),
    closedAt: null,
  };

  if (existing) {
    await prisma.opportunity.update({
      where: { id: existing.id },
      data,
    });
    return "updated";
  }

  await prisma.opportunity.create({
    data: { userId, ...data },
  });
  return "created";
}

async function seedAccount(account, passwordHash) {
  const user = await upsertShowcaseUser(account, passwordHash);
  await syncNetworkLocations(user.id, account.networkCities);

  const listingResults = [];
  for (const product of account.products) {
    listingResults.push(await upsertListing(user.id, account, product));
  }

  await refreshStatus(user.id, account.statusText);
  const oppAction = await refreshOpportunity(
    user.id,
    account,
    account.opportunity,
  );

  return {
    username: account.username,
    userId: user.id,
    city: account.city,
    country: account.country,
    products: account.products.length,
    listings: listingResults,
    opportunity: oppAction,
  };
}

async function main() {
  console.log(
    DRY_RUN
      ? "DRY RUN — no database writes. Pass --confirm to apply.\n"
      : "LIVE RUN — writing showcase accounts…\n",
  );

  const beforeUsers = await prisma.user.findMany({
    where: showcaseUserWhere(),
    select: { id: true, username: true },
  });
  const beforeIds = beforeUsers.map((u) => u.id);
  const beforeCounts = await countShowcaseEntities(beforeIds);
  printCounts("Before", beforeCounts);

  if (DRY_RUN) {
    console.log("\nWould upsert showcase accounts:");
    for (const account of SHOWCASE_ACCOUNTS) {
      console.log(
        `  @${account.username} (${account.city}, ${account.country}) — ${account.products.length} products, 1 status, 1 opportunity, ${account.networkCities.length} network cities`,
      );
    }
    console.log(`\nDemo login password (when --confirm): ${DEMO_PASSWORD}`);
    console.log("Re-run with: npm run seed:showcase -- --confirm");
    return;
  }

  const passwordHash = hashPassword(DEMO_PASSWORD);
  const results = [];

  for (const account of SHOWCASE_ACCOUNTS) {
    const result = await seedAccount(account, passwordHash);
    results.push(result);
    console.log(
      `OK @${result.username} — ${result.products} products (${result.listings.map((l) => l.action).join(", ")}) · opportunity ${result.opportunity}`,
    );
  }

  const afterUsers = await prisma.user.findMany({
    where: showcaseUserWhere(),
    select: { id: true },
  });
  const afterCounts = await countShowcaseEntities(afterUsers.map((u) => u.id));
  console.log("");
  printCounts("After", afterCounts);

  console.log("\nShowcase accounts summary:");
  for (const r of results) {
    console.log(
      `  @${r.username} · ${r.city}, ${r.country} · ${r.products} products`,
    );
  }
  console.log(`\nDemo sign-in password: ${DEMO_PASSWORD}`);
  console.log("(isDemo accounts — messaging remains blocked in app flows.)");
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
