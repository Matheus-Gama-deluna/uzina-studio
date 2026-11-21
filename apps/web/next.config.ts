import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@electric-sql/pglite",
    "pg",
    "@mastra/core",
    "@mastra/libsql",
    "@mastra/pg",
    "@libsql/client",
  ],
  outputFileTracingIncludes: {
    "/**": ["../../packages/db/drizzle/**/*", "../../packages/skills/**/*"],
  },
};

export default nextConfig;
