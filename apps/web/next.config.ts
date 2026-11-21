import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  outputFileTracingIncludes: {
    "/**": ["../../packages/db/drizzle/**/*"],
  },
};

export default nextConfig;
