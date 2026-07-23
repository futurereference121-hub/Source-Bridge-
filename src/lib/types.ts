export type Availability = "in_stock" | "limited" | "made_to_order" | "preorder";

export type Currency = "USD" | "EUR" | "THB" | "RUB";

/** Internal only — never render on the customer storefront. */
export interface SupplierInfo {
  code: string;
  region: "Thailand" | "Russia" | "Other";
  notes?: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  subcategory?: string;
  images: string[];
  price: number;
  currency: Currency;
  /** INTERNAL — do not display to customers */
  supplier: SupplierInfo;
  availability: Availability;
  tags: string[];
  featured: boolean;
  specs?: Record<string, string>;
  shippingNote?: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  image: string;
  subcategories: Subcategory[];
}

export interface Subcategory {
  id: string;
  slug: string;
  name: string;
}

export interface NavItem {
  label: string;
  href: string;
}
