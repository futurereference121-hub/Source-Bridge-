import type { Metadata, Viewport } from "next";
import { Cormorant, Outfit } from "next/font/google";
import { SiteShell } from "@/components/layout/SiteShell";
import { siteConfig } from "@/lib/site";
import {
  PWA_DESCRIPTION,
  PWA_NAME,
  PWA_THEME_COLOR,
} from "@/lib/pwa/constants";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

/** Kept for any legacy className bindings; brand UI uses Outfit sans */
const cormorant = Cormorant({
  variable: "--font-cormorant",
  subsets: ["latin"],
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: PWA_THEME_COLOR,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: `${siteConfig.name} | People-Powered Network`,
    template: `%s | ${siteConfig.name}`,
  },
  description: PWA_DESCRIPTION,
  keywords: [
    "people-powered network",
    "personal sourcing",
    "member profiles",
    "local access",
    "travel access",
  ],
  applicationName: PWA_NAME,
  appleWebApp: {
    capable: true,
    title: PWA_NAME,
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: siteConfig.name,
    description: PWA_DESCRIPTION,
    type: "website",
    siteName: siteConfig.name,
    url: "https://www.sourcebridge.app",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${outfit.variable} ${cormorant.variable} antialiased`}>
        {/* Early Mux CDN hints - kept in body so App Router Metadata owns <head>. */}
        <link rel="preconnect" href="https://stream.mux.com" />
        <link rel="preconnect" href="https://image.mux.com" />
        <link rel="preconnect" href="https://cloudflarestream.com" />
        <link rel="dns-prefetch" href="https://stream.mux.com" />
        <link rel="dns-prefetch" href="https://cloudflarestream.com" />
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}