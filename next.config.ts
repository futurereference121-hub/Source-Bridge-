import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.blob.vercel-storage.com",
        pathname: "/**",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/shop",
        destination: "/explore",
        permanent: false,
      },
      {
        source: "/shop/:slug",
        destination: "/marketplace/:slug",
        permanent: false,
      },
      {
        source: "/marketplace",
        destination: "/explore",
        permanent: false,
      },
      // Legacy showcase usernames → natural handles
      {
        source: "/members/sb_cdmx",
        destination: "/members/lucia.in.mexico",
        permanent: true,
      },
      {
        source: "/members/sb_cartagena",
        destination: "/members/valentina.cartagena",
        permanent: true,
      },
      {
        source: "/members/sb_dahab",
        destination: "/members/omar.dahab",
        permanent: true,
      },
      {
        source: "/members/sb_hurghada",
        destination: "/members/nadia.redsea",
        permanent: true,
      },
      {
        source: "/members/sb_oaxaca",
        destination: "/members/mateo.oaxaca",
        permanent: true,
      },
      {
        source: "/members/sb_chiangmai",
        destination: "/members/siriporn.chiangmai",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
