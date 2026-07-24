import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Handshake,
  Home,
  Languages,
  MapPinned,
  Package,
  Plane,
  Search,
  Ship,
} from "lucide-react";
import type { MemberServiceKey } from "@/lib/types";

export const SERVICE_META: Record<
  MemberServiceKey,
  { label: string; description: string; icon: LucideIcon }
> = {
  canSource: {
    label: "Can source",
    description: "Find and purchase items on your behalf",
    icon: Package,
  },
  canInspect: {
    label: "Can inspect",
    description: "Check quality, condition, and authenticity in person",
    icon: Search,
  },
  canNegotiate: {
    label: "Can negotiate",
    description: "Discuss price and terms with local sellers",
    icon: Handshake,
  },
  canTranslate: {
    label: "Can translate",
    description: "Bridge language gaps with sellers and makers",
    icon: Languages,
  },
  canRecommendSuppliers: {
    label: "Recommend suppliers & artisans",
    description: "Introduce trusted makers and local partners",
    icon: Boxes,
  },
  canReceiveDeliveries: {
    label: "Receive deliveries",
    description: "Accept parcels at a local address",
    icon: Home,
  },
  canShipInternationally: {
    label: "Ship internationally",
    description: "Arrange cross-border delivery",
    icon: Ship,
  },
  canCarryWhileTravelling: {
    label: "Carry while travelling",
    description: "Bring legal items along on upcoming trips",
    icon: Plane,
  },
  hasLocalKnowledge: {
    label: "Local knowledge",
    description: "Context on markets, customs, and where to look",
    icon: MapPinned,
  },
};

export function getActiveServices(services: Record<MemberServiceKey, boolean>) {
  return (Object.keys(SERVICE_META) as MemberServiceKey[]).filter(
    (key) => services[key],
  );
}
