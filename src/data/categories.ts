import type { Category } from "@/lib/types";

export const categories: Category[] = [
  {
    id: "cat-clothing",
    slug: "clothing",
    name: "Clothing",
    description:
      "Apparel shared by members from ateliers and makers — everyday essentials to statement pieces.",
    image:
      "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&q=80",
    subcategories: [
      { id: "sub-tracksuits", slug: "tracksuits", name: "Tracksuits" },
      { id: "sub-kimonos", slug: "kimonos", name: "Kimonos" },
      { id: "sub-dresses", slug: "dresses", name: "Dresses" },
      { id: "sub-shirts", slug: "shirts", name: "Shirts" },
      { id: "sub-pants", slug: "pants", name: "Pants" },
      { id: "sub-bags", slug: "bags", name: "Bags" },
      { id: "sub-hats", slug: "hats", name: "Hats" },
      { id: "sub-hand-knitted", slug: "hand-knitted", name: "Hand Knitted" },
    ],
  },
  {
    id: "cat-jewellery",
    slug: "jewellery",
    name: "Jewellery",
    description:
      "Watches, silverwork, antiques, and fine adornments selected for craftsmanship and lasting value.",
    image:
      "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=1200&q=80",
    subcategories: [
      { id: "sub-watches", slug: "watches", name: "Watches" },
      { id: "sub-silver", slug: "silver", name: "Silver" },
      { id: "sub-jew-antiques", slug: "antiques", name: "Antiques" },
      { id: "sub-necklaces", slug: "necklaces", name: "Necklaces" },
      { id: "sub-bracelets", slug: "bracelets", name: "Bracelets" },
      { id: "sub-rings", slug: "rings", name: "Rings" },
    ],
  },
  {
    id: "cat-home",
    slug: "home-living",
    name: "Home & Living",
    description:
      "Decor, kitchenware, furniture, and crafts that bring international character into everyday spaces.",
    image:
      "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1200&q=80",
    subcategories: [
      { id: "sub-decor", slug: "decor", name: "Decor" },
      { id: "sub-kitchen", slug: "kitchen", name: "Kitchen" },
      { id: "sub-furniture", slug: "furniture", name: "Furniture" },
      { id: "sub-crafts", slug: "crafts", name: "Crafts" },
    ],
  },
  {
    id: "cat-collectibles",
    slug: "collectibles",
    name: "Collectibles",
    description:
      "Antiques, rare finds, and limited editions for collectors who value provenance and scarcity.",
    image:
      "https://images.unsplash.com/photo-1577083552431-6e5fd01988ec?w=1200&q=80",
    subcategories: [
      { id: "sub-col-antiques", slug: "antiques", name: "Antiques" },
      { id: "sub-rare-finds", slug: "rare-finds", name: "Rare Finds" },
      { id: "sub-limited", slug: "limited-items", name: "Limited Items" },
    ],
  },
];

export function getCategoryBySlug(slug: string): Category | undefined {
  return categories.find((c) => c.slug === slug);
}

export function getAllCategorySlugs(): string[] {
  return categories.map((c) => c.slug);
}
