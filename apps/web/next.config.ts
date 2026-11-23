import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.UZINA_STANDALONE === "1"
    ? { output: "standalone" as const }
    : {}),
  serverExternalPackages: [
    "@electric-sql/pglite",
    "pg",
    "@mastra/core",
    "@mastra/memory",
    "@mastra/libsql",
    "@mastra/pg",
    "@libsql/client",
  ],
  outputFileTracingIncludes: {
    "/**": ["../../packages/db/drizzle/**/*", "../../packages/skills/**/*"],
  },
};

export default nextConfig;
