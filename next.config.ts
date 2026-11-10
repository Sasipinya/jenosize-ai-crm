import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pino and pg must run as plain Node modules, not bundled.
  serverExternalPackages: ["pino", "pg"],
  poweredByHeader: false,
};

export default nextConfig;
