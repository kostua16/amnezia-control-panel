import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow HMR when the browser mixes localhost and 127.0.0.1 (default dev guard blocks it).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
