import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // pdfjs-dist requires canvas which isn't available in Node.js
    config.resolve.alias["canvas"] = false;
    return config;
  },
};

export default nextConfig;
