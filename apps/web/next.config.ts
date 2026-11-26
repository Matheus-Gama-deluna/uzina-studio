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
    "web-push",
  ],
  outputFileTracingIncludes: {
    "/**": ["../../packages/db/drizzle/**/*", "../../packages/skills/**/*"],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          {
            key: "Permissions-Policy",
            value: "microphone=(self), camera=(), geolocation=()",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
