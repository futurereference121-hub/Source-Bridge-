import type { Member } from "@/lib/types";

/**
 * Seed community members for the prototype directory.
 * Profiles are the product; products attach to people.
 * Usernames are primary identity (@handle style).
 */

/** Helpers: status timestamps relative to "now" for prototype. */
const HOURS = 60 * 60 * 1000;
const daysAgo = (d: number) =>
  new Date(Date.now() - d * 24 * HOURS).toISOString();
const hoursFromNow = (h: number) =>
  new Date(Date.now() + h * HOURS).toISOString();
const hoursAgo = (h: number) =>
  new Date(Date.now() - h * HOURS).toISOString();

export const members: Member[] = [
  {
    id: "m-niran-chai",
    slug: "niran-chai",
    username: "bangkoklocal",
    fullName: "Niran Chai",
    photo:
      "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=600&q=80",
    cover:
      "https://images.unsplash.com/photo-1552465011-b4e21bf6e79a?w=1600&q=80",
    location: {
      city: "Bangkok",
      country: "Thailand",
      label: "Bangkok, Thailand",
      cityCode: "bangkok",
      countryCode: "TH",
    },
    howICanHelp:
      "Local markets, silk ateliers, and hard-to-find Thai crafts — inspected in person before they ship.",
    bio: "Bangkok-based member who knows Chatuchak, riverside workshops, and quiet makers outside the tourist path. Happy to source, inspect, and arrange careful shipping.",
    memberType: "local",
    verification: {
      identityVerified: true,
      badges: [
        { kind: "verified_identity", label: "Verified Identity", placeholder: true },
        { kind: "trusted_member", label: "Trusted Member", placeholder: true },
        { kind: "specialist", label: "Specialist", placeholder: true },
      ],
    },
    bridgeScore: 94,
    rating: 4.9,
    completedRequests: 61,
    services: [
      { id: "s-source", label: "Local sourcing" },
      { id: "s-inspect", label: "In-person inspection" },
      { id: "s-ship", label: "International shipping" },
      { id: "s-negotiate", label: "Negotiation" },
    ],
    network: [
      { city: "Bangkok", country: "Thailand", cityCode: "bangkok", countryCode: "TH" },
      { city: "Chiang Mai", country: "Thailand", countryCode: "TH" },
      { city: "Luang Prabang", country: "Laos", countryCode: "LA" },
    ],
    trips: [],
    status: {
      text: "Available today.",
      postedAt: hoursAgo(3),
      expiresAt: hoursFromNow(21),
    },
    opportunity: {
      id: "opp-nc-1",
      summary: "Open for silk and craft sourcing in Bangkok this week.",
      availability: "Weekdays, same-day inspection",
      localAccess: "Chatuchak, riverside ateliers, silk workshops",
      stock: "Silk pieces and small craft finds on hand",
      categories: ["silk", "handicrafts", "textiles"],
      city: "Bangkok",
      country: "Thailand",
      cityCode: "bangkok",
      countryCode: "TH",
      postedAt: daysAgo(1),
    },
    connectedCountries: [
      { country: "Thailand", kind: "lives" },
      { country: "Laos", kind: "sources" },
      { country: "Cambodia", kind: "visits" },
    ],
    upcomingJourney: null,
    journeys: [],
    availability: "available_now",
    availabilityLabel: "Available now",
    listingIds: ["p-001", "p-002", "p-003"],
    reviews: [
      {
        id: "r-nc-1",
        authorName: "Maya L.",
        rating: 5,
        text: "Found exactly the silk I wanted and sent clear photos before purchase.",
        dateLabel: "Jun 2026",
      },
      {
        id: "r-nc-2",
        authorName: "Tomás R.",
        rating: 5,
        text: "Reliable, fast replies, and careful packing.",
        dateLabel: "May 2026",
      },
    ],
    recentActivity: [
      {
        id: "a-nc-1",
        type: "listing",
        title: "Added a new find",
        detail: "Bangkok Evening Kimono",
        dateLabel: "2 days ago",
      },
      {
        id: "a-nc-2",
        type: "request",
        title: "Completed a sourcing request",
        detail: "Handwoven cotton for a Berlin client",
        dateLabel: "1 week ago",
      },
    ],
    languages: ["Thai", "English"],
    joinedAt: "2025-03-12",
    isPrototype: true,
  },
  {
    id: "m-sofia-mendez",
    slug: "sofia-mendez",
    username: "routebridge",
    fullName: "Sofía Méndez",
    photo:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&q=80",
    cover:
      "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=1600&q=80",
    location: {
      city: "Bangkok",
      country: "Thailand",
      label: "Bangkok, Thailand",
      cityCode: "bangkok",
      countryCode: "TH",
    },
    howICanHelp:
      "Travelling Bangkok → Madrid soon — can carry legal finds and connect you to makers along the route.",
    bio: "Designer and frequent traveller bridging Southeast Asia and Spain. Uses trips to move carefully selected pieces and introduce trusted contacts.",
    memberType: "traveller",
    verification: {
      identityVerified: true,
      badges: [
        { kind: "verified_identity", label: "Verified Identity", placeholder: true },
        { kind: "traveller", label: "Traveller", placeholder: true },
        { kind: "trusted_member", label: "Trusted Member", placeholder: true },
      ],
    },
    bridgeScore: 88,
    rating: 4.8,
    completedRequests: 29,
    services: [
      { id: "s-carry", label: "Carry while travelling" },
      { id: "s-source", label: "Local sourcing" },
      { id: "s-translate", label: "Translation" },
    ],
    network: [
      { city: "Bangkok", country: "Thailand", cityCode: "bangkok", countryCode: "TH" },
      { city: "Madrid", country: "Spain", countryCode: "ES" },
      { city: "Lisbon", country: "Portugal", countryCode: "PT" },
    ],
    trips: [
      { id: "t-sm-1", city: "Madrid", country: "Spain", dateRange: "12–28 August" },
      { id: "t-sm-2", city: "Lisbon", country: "Portugal", dateRange: "September 2026" },
    ],
    status: {
      text: "Travelling to Madrid next week.",
      postedAt: hoursAgo(8),
      expiresAt: hoursFromNow(16),
    },
    opportunity: {
      id: "opp-sm-1",
      summary: "Carrying capacity Bangkok → Madrid; open to a few legal finds.",
      availability: "Limited carry slots",
      travel: "Bangkok to Madrid, mid-August",
      categories: ["fashion samples", "small crafts"],
      city: "Bangkok",
      country: "Thailand",
      cityCode: "bangkok",
      countryCode: "TH",
      postedAt: daysAgo(2),
    },
    connectedCountries: [
      { country: "Thailand", kind: "visits" },
      { country: "Spain", kind: "lives" },
      { country: "Portugal", kind: "travels" },
    ],
    upcomingJourney: {
      id: "j-sm-1",
      from: "Bangkok",
      to: "Madrid",
      datesLabel: "Aug 12–28, 2026",
      note: "Open to a few carry requests",
    },
    journeys: [
      {
        id: "j-sm-1",
        from: "Bangkok",
        to: "Madrid",
        datesLabel: "Aug 12–28, 2026",
        note: "Open to a few carry requests",
      },
      {
        id: "j-sm-2",
        from: "Madrid",
        to: "Lisbon",
        datesLabel: "Sep 2026",
        note: "Short design-district trip",
      },
    ],
    availability: "travelling_soon",
    availabilityLabel: "Travelling soon",
    listingIds: ["p-004", "p-005"],
    reviews: [
      {
        id: "r-sm-1",
        authorName: "Elena V.",
        rating: 5,
        text: "Brought a sample from Bangkok to Madrid without fuss. Clear communication the whole way.",
        dateLabel: "Apr 2026",
      },
    ],
    recentActivity: [
      {
        id: "a-sm-1",
        type: "journey",
        title: "Posted upcoming journey",
        detail: "Bangkok → Madrid",
        dateLabel: "3 days ago",
      },
    ],
    languages: ["Spanish", "English", "Thai"],
    joinedAt: "2025-08-01",
    isPrototype: true,
  },
  {
    id: "m-dmitri-volkov",
    slug: "dmitri-volkov",
    username: "moscowantiques",
    fullName: "Dmitri Volkov",
    photo:
      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=600&q=80",
    cover:
      "https://images.unsplash.com/photo-1513326738677-b964603b136d?w=1600&q=80",
    location: {
      city: "Moscow",
      country: "Russia",
      label: "Moscow, Russia",
      cityCode: "moscow",
      countryCode: "RU",
    },
    howICanHelp:
      "Antiques, Soviet-era design objects, and flea-market finds — authenticated and documented.",
    bio: "Collector and specialist focused on antiques and mid-century pieces across Moscow and regional markets. Shares provenance notes with every find.",
    memberType: "specialist",
    verification: {
      identityVerified: true,
      badges: [
        { kind: "verified_identity", label: "Verified Identity", placeholder: true },
        { kind: "specialist", label: "Specialist", placeholder: true },
        { kind: "top_rated", label: "Top Rated", placeholder: true },
      ],
    },
    bridgeScore: 91,
    rating: 4.9,
    completedRequests: 44,
    services: [
      { id: "s-source", label: "Antique sourcing" },
      { id: "s-inspect", label: "Authentication" },
      { id: "s-ship", label: "Careful shipping" },
      { id: "s-knowledge", label: "Local knowledge" },
    ],
    network: [
      { city: "Moscow", country: "Russia", cityCode: "moscow", countryCode: "RU" },
      { city: "Saint Petersburg", country: "Russia", countryCode: "RU" },
      { city: "Tbilisi", country: "Georgia", countryCode: "GE" },
    ],
    trips: [
      {
        id: "t-dv-1",
        city: "Saint Petersburg",
        country: "Russia",
        dateRange: "September 2026",
      },
    ],
    status: {
      text: "Open for sourcing.",
      postedAt: hoursAgo(1),
      expiresAt: hoursFromNow(23),
    },
    opportunity: {
      id: "opp-dv-1",
      summary: "Antique and mid-century sourcing across Moscow markets.",
      availability: "Weekends preferred",
      localAccess: "Izmailovo, weekend flea circuits",
      stock: "Select authenticated pieces on hand",
      categories: ["antiques", "mid-century design"],
      city: "Moscow",
      country: "Russia",
      cityCode: "moscow",
      countryCode: "RU",
      postedAt: daysAgo(3),
    },
    connectedCountries: [
      { country: "Russia", kind: "lives" },
      { country: "Georgia", kind: "sources" },
      { country: "Finland", kind: "travels" },
    ],
    upcomingJourney: {
      id: "j-dv-1",
      from: "Moscow",
      to: "Saint Petersburg",
      datesLabel: "Sep 2026",
      note: "Weekend market circuit",
    },
    journeys: [
      {
        id: "j-dv-1",
        from: "Moscow",
        to: "Saint Petersburg",
        datesLabel: "Sep 2026",
        note: "Weekend market circuit",
      },
    ],
    availability: "available_now",
    availabilityLabel: "Available now",
    listingIds: ["p-010", "p-011", "p-012"],
    reviews: [
      {
        id: "r-dv-1",
        authorName: "Claire H.",
        rating: 5,
        text: "Expert eye. The condition report matched the piece perfectly.",
        dateLabel: "Mar 2026",
      },
    ],
    recentActivity: [
      {
        id: "a-dv-1",
        type: "listing",
        title: "Listed a new antique find",
        detail: "From a weekend flea market",
        dateLabel: "5 days ago",
      },
    ],
    languages: ["Russian", "English"],
    joinedAt: "2025-01-20",
    isPrototype: true,
  },
  {
    id: "m-aylin-demir",
    slug: "aylin-demir",
    username: "istanbulfashion",
    fullName: "Aylin Demir",
    photo:
      "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=600&q=80",
    cover:
      "https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=1600&q=80",
    location: {
      city: "Istanbul",
      country: "Turkey",
      label: "Istanbul, Turkey",
      cityCode: "istanbul",
      countryCode: "TR",
    },
    howICanHelp:
      "Fashion ateliers, textiles, and leather goods from Istanbul’s working districts.",
    bio: "Works with small fashion houses and textile workshops. Helps members find samples, negotiate small runs, and understand local sizing and materials.",
    memberType: "specialist",
    verification: {
      identityVerified: true,
      badges: [
        { kind: "verified_identity", label: "Verified Identity", placeholder: true },
        { kind: "business_verified", label: "Business Verified", placeholder: true },
        { kind: "specialist", label: "Specialist", placeholder: true },
      ],
    },
    bridgeScore: 87,
    rating: 4.7,
    completedRequests: 36,
    services: [
      { id: "s-fashion", label: "Fashion sourcing" },
      { id: "s-negotiate", label: "Negotiation" },
      { id: "s-translate", label: "Translation" },
      { id: "s-ship", label: "International shipping" },
    ],
    network: [
      { city: "Istanbul", country: "Turkey", cityCode: "istanbul", countryCode: "TR" },
      { city: "Milan", country: "Italy", countryCode: "IT" },
      { city: "Athens", country: "Greece", countryCode: "GR" },
    ],
    trips: [],
    status: null,
    opportunity: {
      id: "opp-ad-1",
      summary: "Leather and textile atelier access in Istanbul — limited slots.",
      availability: "Limited this month",
      localAccess: "Working-district ateliers and leather workshops",
      categories: ["leather", "textiles", "fashion samples"],
      city: "Istanbul",
      country: "Turkey",
      cityCode: "istanbul",
      countryCode: "TR",
      postedAt: daysAgo(4),
    },
    connectedCountries: [
      { country: "Turkey", kind: "lives" },
      { country: "Italy", kind: "travels" },
      { country: "Greece", kind: "visits" },
    ],
    upcomingJourney: null,
    journeys: [],
    availability: "limited",
    availabilityLabel: "Limited availability",
    listingIds: ["p-006", "p-007"],
    reviews: [
      {
        id: "r-ad-1",
        authorName: "Priya S.",
        rating: 5,
        text: "Connected me with a leather workshop I would never have found alone.",
        dateLabel: "Feb 2026",
      },
    ],
    recentActivity: [
      {
        id: "a-ad-1",
        type: "review",
        title: "Received a new review",
        detail: "5★ from Priya S.",
        dateLabel: "1 week ago",
      },
    ],
    languages: ["Turkish", "English", "Italian"],
    joinedAt: "2025-05-08",
    isPrototype: true,
  },
  {
    id: "m-yuki-tanaka",
    slug: "yuki-tanaka",
    username: "tokyochecks",
    fullName: "Yuki Tanaka",
    photo:
      "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=600&q=80",
    cover:
      "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1600&q=80",
    location: {
      city: "Tokyo",
      country: "Japan",
      label: "Tokyo, Japan",
      cityCode: "tokyo",
      countryCode: "JP",
    },
    howICanHelp:
      "Student in Tokyo — happy to check stores, compare options, and ship small finds.",
    bio: "University student with weekends free for store checks, second-hand browsing, and careful packing of small items across Japan.",
    memberType: "student",
    verification: {
      identityVerified: false,
      badges: [{ kind: "traveller", label: "Traveller", placeholder: true }],
    },
    bridgeScore: 72,
    rating: 4.6,
    completedRequests: 12,
    services: [
      { id: "s-check", label: "Store checks" },
      { id: "s-source", label: "Small-item sourcing" },
      { id: "s-translate", label: "Japanese ↔ English" },
    ],
    network: [
      { city: "Tokyo", country: "Japan", cityCode: "tokyo", countryCode: "JP" },
      { city: "Osaka", country: "Japan", countryCode: "JP" },
      { city: "Seoul", country: "South Korea", countryCode: "KR" },
    ],
    trips: [
      { id: "t-yt-1", city: "Osaka", country: "Japan", dateRange: "August 2026" },
      {
        id: "t-yt-2",
        city: "Tokyo",
        country: "Japan",
        dateRange: "12–20 September",
      },
    ],
    status: {
      text: "Returning Friday.",
      postedAt: hoursAgo(5),
      expiresAt: hoursFromNow(19),
    },
    opportunity: null,
    connectedCountries: [
      { country: "Japan", kind: "lives" },
      { country: "South Korea", kind: "visits" },
    ],
    upcomingJourney: {
      id: "j-yt-1",
      from: "Tokyo",
      to: "Osaka",
      datesLabel: "Aug 2026",
      note: "Weekend — open to store visits",
    },
    journeys: [
      {
        id: "j-yt-1",
        from: "Tokyo",
        to: "Osaka",
        datesLabel: "Aug 2026",
        note: "Weekend — open to store visits",
      },
    ],
    availability: "available_now",
    availabilityLabel: "Available now",
    listingIds: ["p-008"],
    reviews: [
      {
        id: "r-yt-1",
        authorName: "James K.",
        rating: 5,
        text: "Checked three shops the same afternoon and sent video. Super helpful.",
        dateLabel: "Jul 2026",
      },
    ],
    recentActivity: [
      {
        id: "a-yt-1",
        type: "request",
        title: "Completed a store-check request",
        detail: "Vintage camera comparison in Shimokitazawa",
        dateLabel: "4 days ago",
      },
    ],
    languages: ["Japanese", "English"],
    joinedAt: "2026-01-15",
    isPrototype: true,
  },
  {
    id: "m-ananya-rao",
    slug: "ananya-rao",
    username: "jaipurjewels",
    fullName: "Ananya Rao",
    photo:
      "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=600&q=80",
    cover:
      "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=1600&q=80",
    location: {
      city: "Jaipur",
      country: "India",
      label: "Jaipur, India",
      cityCode: "jaipur",
      countryCode: "IN",
    },
    howICanHelp:
      "Jewellery artisans, gemstone markets, and custom silver work from Jaipur workshops.",
    bio: "Works closely with family-run jewellery ateliers. Helps with design briefs, quality checks, and secure shipping of finished pieces.",
    memberType: "specialist",
    verification: {
      identityVerified: true,
      badges: [
        { kind: "verified_identity", label: "Verified Identity", placeholder: true },
        { kind: "specialist", label: "Specialist", placeholder: true },
        { kind: "trusted_member", label: "Trusted Member", placeholder: true },
      ],
    },
    bridgeScore: 90,
    rating: 4.9,
    completedRequests: 52,
    services: [
      { id: "s-jewellery", label: "Jewellery sourcing" },
      { id: "s-inspect", label: "Quality inspection" },
      { id: "s-custom", label: "Custom commissions" },
      { id: "s-ship", label: "Secure shipping" },
    ],
    network: [
      { city: "Jaipur", country: "India", cityCode: "jaipur", countryCode: "IN" },
      { city: "Mumbai", country: "India", countryCode: "IN" },
      { city: "Dubai", country: "UAE", countryCode: "AE" },
    ],
    trips: [],
    status: {
      text: "Available today.",
      postedAt: hoursAgo(2),
      expiresAt: hoursFromNow(22),
    },
    opportunity: {
      id: "opp-ar-1",
      summary: "Custom silver and gemstone commissions open in Jaipur.",
      availability: "Open for new briefs",
      localAccess: "Family ateliers and gemstone markets",
      stock: "Sample silver pieces available",
      categories: ["jewellery", "gemstones", "silverwork"],
      city: "Jaipur",
      country: "India",
      cityCode: "jaipur",
      countryCode: "IN",
      postedAt: hoursAgo(20),
    },
    connectedCountries: [
      { country: "India", kind: "lives" },
      { country: "UAE", kind: "travels" },
      { country: "UK", kind: "sources" },
    ],
    upcomingJourney: null,
    journeys: [],
    availability: "available_now",
    availabilityLabel: "Available now",
    listingIds: ["p-013", "p-014"],
    reviews: [
      {
        id: "r-ar-1",
        authorName: "Helen W.",
        rating: 5,
        text: "Beautiful craftsmanship and transparent communication on every step.",
        dateLabel: "May 2026",
      },
    ],
    recentActivity: [
      {
        id: "a-ar-1",
        type: "listing",
        title: "Shared a new jewellery find",
        detail: "Hand-set silver from a Jaipur atelier",
        dateLabel: "Yesterday",
      },
    ],
    languages: ["Hindi", "English"],
    joinedAt: "2024-11-02",
    isPrototype: true,
  },
  {
    id: "m-camila-ortiz",
    slug: "camila-ortiz",
    username: "globalnomad",
    fullName: "Camila Ortiz",
    photo:
      "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=600&q=80",
    cover:
      "https://images.unsplash.com/photo-1518659526054-03338cfc0670?w=1600&q=80",
    location: {
      city: "Mexico City",
      country: "Mexico",
      label: "Mexico City, Mexico",
      cityCode: "mexico city",
      countryCode: "MX",
    },
    howICanHelp:
      "Digital nomad covering Mexico and Central America — crafts, ceramics, and local makers.",
    bio: "Moves between Mexico City, Oaxaca, and Guatemala. Connects members with ceramicists, textile cooperatives, and contemporary craft studios.",
    memberType: "nomad",
    verification: {
      identityVerified: true,
      badges: [
        { kind: "verified_identity", label: "Verified Identity", placeholder: true },
        { kind: "traveller", label: "Traveller", placeholder: true },
      ],
    },
    bridgeScore: 83,
    rating: 4.7,
    completedRequests: 21,
    services: [
      { id: "s-craft", label: "Craft sourcing" },
      { id: "s-carry", label: "Carry while travelling" },
      { id: "s-knowledge", label: "Local knowledge" },
    ],
    network: [
      { city: "Mexico City", country: "Mexico", cityCode: "mexico city", countryCode: "MX" },
      { city: "Oaxaca", country: "Mexico", cityCode: "oaxaca", countryCode: "MX" },
      { city: "Antigua", country: "Guatemala", countryCode: "GT" },
      { city: "Bogotá", country: "Colombia", cityCode: "bogota", countryCode: "CO" },
    ],
    trips: [
      { id: "t-co-1", city: "Oaxaca", country: "Mexico", dateRange: "August 2026" },
      { id: "t-co-2", city: "Antigua", country: "Guatemala", dateRange: "September 2026" },
    ],
    status: {
      text: "Travelling to Oaxaca next week.",
      postedAt: hoursAgo(6),
      expiresAt: hoursFromNow(18),
    },
    opportunity: {
      id: "opp-co-1",
      summary: "Ceramic studio access on the Mexico City → Oaxaca route.",
      availability: "While travelling",
      travel: "Mexico City to Oaxaca, August",
      localAccess: "Ceramic studios and textile cooperatives",
      categories: ["ceramics", "textiles", "crafts"],
      city: "Oaxaca",
      country: "Mexico",
      cityCode: "oaxaca",
      countryCode: "MX",
      postedAt: daysAgo(1),
    },
    connectedCountries: [
      { country: "Mexico", kind: "lives" },
      { country: "Guatemala", kind: "travels" },
      { country: "Colombia", kind: "visits" },
    ],
    upcomingJourney: {
      id: "j-co-1",
      from: "Mexico City",
      to: "Oaxaca",
      datesLabel: "Aug 2026",
      note: "Ceramic studio visits",
    },
    journeys: [
      {
        id: "j-co-1",
        from: "Mexico City",
        to: "Oaxaca",
        datesLabel: "Aug 2026",
        note: "Ceramic studio visits",
      },
      {
        id: "j-co-2",
        from: "Oaxaca",
        to: "Antigua",
        datesLabel: "Sep 2026",
        note: "Textile cooperatives",
      },
    ],
    availability: "travelling_soon",
    availabilityLabel: "Travelling soon",
    listingIds: ["p-015", "p-016"],
    reviews: [
      {
        id: "r-co-1",
        authorName: "Noah P.",
        rating: 4,
        text: "Great taste and honest about timelines while on the road.",
        dateLabel: "Jun 2026",
      },
    ],
    recentActivity: [
      {
        id: "a-co-1",
        type: "journey",
        title: "Updated travel plans",
        detail: "Mexico City → Oaxaca",
        dateLabel: "2 days ago",
      },
    ],
    languages: ["Spanish", "English"],
    joinedAt: "2025-09-18",
    isPrototype: true,
  },
  {
    id: "m-edward-blake",
    slug: "edward-blake",
    username: "londoncollector",
    fullName: "Edward Blake",
    photo:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=600&q=80",
    cover:
      "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1600&q=80",
    location: {
      city: "London",
      country: "United Kingdom",
      label: "London, United Kingdom",
      cityCode: "london",
      countryCode: "GB",
    },
    howICanHelp:
      "UK collector helping locate rare books, prints, and estate-sale finds across Britain.",
    bio: "Long-time collector who attends auctions and regional sales. Prefers thoughtful matches over volume — especially books, prints, and design objects.",
    memberType: "collector",
    verification: {
      identityVerified: true,
      badges: [
        { kind: "verified_identity", label: "Verified Identity", placeholder: true },
        { kind: "trusted_member", label: "Trusted Member", placeholder: true },
        { kind: "top_rated", label: "Top Rated", placeholder: true },
      ],
    },
    bridgeScore: 89,
    rating: 4.8,
    completedRequests: 33,
    services: [
      { id: "s-collect", label: "Collector sourcing" },
      { id: "s-auction", label: "Auction attendance" },
      { id: "s-inspect", label: "Condition reports" },
      { id: "s-ship", label: "UK & EU shipping" },
    ],
    network: [
      { city: "London", country: "United Kingdom", cityCode: "london", countryCode: "GB" },
      { city: "Edinburgh", country: "United Kingdom", countryCode: "GB" },
      { city: "Paris", country: "France", cityCode: "paris", countryCode: "FR" },
    ],
    trips: [
      {
        id: "t-eb-1",
        city: "Edinburgh",
        country: "United Kingdom",
        dateRange: "September 2026",
      },
    ],
    status: null,
    opportunity: {
      id: "opp-eb-1",
      summary: "Rare books and prints — open for estate and fair sourcing.",
      availability: "By arrangement",
      localAccess: "London sales and regional fairs",
      categories: ["rare books", "prints", "estate finds"],
      city: "London",
      country: "United Kingdom",
      cityCode: "london",
      countryCode: "GB",
      postedAt: daysAgo(5),
    },
    connectedCountries: [
      { country: "United Kingdom", kind: "lives" },
      { country: "France", kind: "travels" },
      { country: "Ireland", kind: "visits" },
    ],
    upcomingJourney: {
      id: "j-eb-1",
      from: "London",
      to: "Edinburgh",
      datesLabel: "Sep 2026",
      note: "Book fair & estate sales",
    },
    journeys: [
      {
        id: "j-eb-1",
        from: "London",
        to: "Edinburgh",
        datesLabel: "Sep 2026",
        note: "Book fair & estate sales",
      },
    ],
    availability: "limited",
    availabilityLabel: "Limited availability",
    listingIds: ["p-017", "p-018"],
    reviews: [
      {
        id: "r-eb-1",
        authorName: "Amelia F.",
        rating: 5,
        text: "Patient, precise, and found a first edition I had been seeking for years.",
        dateLabel: "Apr 2026",
      },
    ],
    recentActivity: [
      {
        id: "a-eb-1",
        type: "listing",
        title: "Added a collector find",
        detail: "Rare print from a London sale",
        dateLabel: "6 days ago",
      },
    ],
    languages: ["English", "French"],
    joinedAt: "2025-02-28",
    isPrototype: true,
  },
];

export function getMemberById(id: string): Member | undefined {
  return members.find((m) => m.id === id);
}

export function getMemberBySlug(slug: string): Member | undefined {
  return members.find((m) => m.slug === slug);
}

export function getMemberByUsername(username: string): Member | undefined {
  const handle = username.replace(/^@/, "").toLowerCase();
  return members.find((m) => m.username.toLowerCase() === handle);
}

/** Resolve owner from listingIds first (seed data), then memberId. */
export function getMemberForListing(listing: {
  id: string;
  memberId: string;
}): Member | undefined {
  return (
    members.find((m) => m.listingIds.includes(listing.id)) ??
    getMemberById(listing.memberId)
  );
}

export function getAllCountries(): string[] {
  const set = new Set<string>();
  for (const m of members) {
    set.add(m.location.country);
    for (const c of m.connectedCountries) set.add(c.country);
    for (const n of m.network) set.add(n.country);
  }
  return Array.from(set).sort();
}

export function getAllCities(): string[] {
  const set = new Set<string>();
  for (const m of members) {
    set.add(m.location.city);
    for (const n of m.network) set.add(n.city);
  }
  return Array.from(set).sort();
}

export function getAllServices(): string[] {
  const set = new Set<string>();
  for (const m of members) {
    for (const s of m.services) set.add(s.label);
  }
  return Array.from(set).sort();
}

export function getAllMemberTypes(): Member["memberType"][] {
  return Array.from(new Set(members.map((m) => m.memberType)));
}
