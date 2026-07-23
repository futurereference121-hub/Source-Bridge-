import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/shop",
        destination: "/marketplace",
        permanent: false,
      },
      {
        source: "/shop/:slug",
        destination: "/marketplace/:slug",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
