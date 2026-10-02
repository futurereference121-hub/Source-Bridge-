import { getAppUrl, isProductionCanonicalHost } from "@/lib/app-url";

export const PILOT_PREVIEW_ORIGIN =
  "https://source-bridge-git-global-payouts-pilot-canna-cake.vercel.app";

/** Non-secret facts about whether Preview can send a normal verification link. */
export function previewMailReadiness() {
  const provider = (process.env.EMAIL_PROVIDER || "console").toLowerCase();
  const key = String(process.env.RESEND_API_KEY || "");
  const fromPresent = Boolean(String(process.env.EMAIL_FROM || "").trim());
  const keyPresent = Boolean(key);
  const keyPrefixOk = key.startsWith("re_");
  const origin = getAppUrl();
  let linkOriginHost = "";
  try {
    linkOriginHost = new URL(origin).hostname.toLowerCase();
  } catch {
    linkOriginHost = "";
  }
  const productionOrigin = isProductionCanonicalHost(linkOriginHost);
  const linkOriginIsPilot = origin === PILOT_PREVIEW_ORIGIN;
  return {
    provider,
    credentials_present: keyPresent && fromPresent,
    key_prefix_ok: keyPrefixOk,
    delivery_supported:
      provider === "resend" && keyPresent && keyPrefixOk && fromPresent && !productionOrigin,
    link_origin_host: linkOriginHost,
    link_origin_is_pilot: linkOriginIsPilot,
    link_path: "/verify-email",
    production_origin: productionOrigin,
  };
}
