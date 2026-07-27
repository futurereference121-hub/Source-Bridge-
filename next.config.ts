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
    ];
  },
};

export default nextConfig;
