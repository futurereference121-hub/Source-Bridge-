/**
 * Tracking provider abstraction.
 * Sellers cannot self-declare tracked DELIVERED — only provider webhooks/admin.
 */

export type NormalizedTrackingStatus =
  | "LABEL_CREATED"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "EXCEPTION"
  | "UNKNOWN";

export type TrackingLookupResult = {
  provider: string;
  trackingNumber: string;
  carrier: string;
  providerStatus: string;
  normalizedStatus: NormalizedTrackingStatus;
  occurredAt: Date | null;
  raw: Record<string, unknown>;
};

export interface TrackingProvider {
  readonly name: string;
  track(trackingNumber: string, carrier?: string): Promise<TrackingLookupResult>;
}

const DELIVERED_HINTS = [
  "delivered",
  "delivery_confirmed",
  "package_delivered",
];
const TRANSIT_HINTS = [
  "in_transit",
  "in transit",
  "picked_up",
  "accepted",
  "departed",
  "arrived",
];
const OUT_HINTS = ["out_for_delivery", "out for delivery"];
const LABEL_HINTS = ["label", "pre_transit", "info_received", "created"];
const EXCEPTION_HINTS = ["exception", "failed", "returned", "undeliverable"];

export function normalizeTrackingStatus(raw: string): NormalizedTrackingStatus {
  const s = (raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!s) return "UNKNOWN";
  if (DELIVERED_HINTS.some((h) => s.includes(h.replace(/\s+/g, "_")))) {
    return "DELIVERED";
  }
  if (OUT_HINTS.some((h) => s.includes(h.replace(/\s+/g, "_")))) {
    return "OUT_FOR_DELIVERY";
  }
  if (EXCEPTION_HINTS.some((h) => s.includes(h.replace(/\s+/g, "_")))) {
    return "EXCEPTION";
  }
  if (TRANSIT_HINTS.some((h) => s.includes(h.replace(/\s+/g, "_")))) {
    return "IN_TRANSIT";
  }
  if (LABEL_HINTS.some((h) => s.includes(h.replace(/\s+/g, "_")))) {
    return "LABEL_CREATED";
  }
  return "UNKNOWN";
}

/** Deterministic mock for local/test — numbers ending in 9 → DELIVERED. */
export class MockTrackingProvider implements TrackingProvider {
  readonly name = "mock";

  async track(
    trackingNumber: string,
    carrier = "",
  ): Promise<TrackingLookupResult> {
    const trimmed = trackingNumber.trim();
    let providerStatus = "in_transit";
    if (/9$/.test(trimmed)) providerStatus = "delivered";
    else if (/0$/.test(trimmed)) providerStatus = "label_created";
    else if (/8$/.test(trimmed)) providerStatus = "exception";
    else if (/7$/.test(trimmed)) providerStatus = "out_for_delivery";

    return {
      provider: this.name,
      trackingNumber: trimmed,
      carrier,
      providerStatus,
      normalizedStatus: normalizeTrackingStatus(providerStatus),
      occurredAt: new Date(),
      raw: { mock: true, providerStatus },
    };
  }
}

/**
 * Production adapter placeholder — wire EasyPost/AfterShip/Shippo later.
 * Throws until a real provider key is configured.
 */
export class ProductionTrackingProviderPlaceholder implements TrackingProvider {
  readonly name = "production_placeholder";

  async track(): Promise<TrackingLookupResult> {
    throw Object.assign(
      new Error(
        "Production tracking provider is not configured. Use MockTrackingProvider while TRACKING_AUTOMATION_ENABLED is off, or set TRACKING_PROVIDER_API_KEY.",
      ),
      { status: 503, code: "TRACKING_PROVIDER_UNCONFIGURED" },
    );
  }
}

export function getTrackingProvider(): TrackingProvider {
  const name = (process.env.TRACKING_PROVIDER || "mock").trim().toLowerCase();
  if (name === "mock" || !process.env.TRACKING_PROVIDER_API_KEY) {
    return new MockTrackingProvider();
  }
  return new ProductionTrackingProviderPlaceholder();
}
