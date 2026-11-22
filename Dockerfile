# syntax=docker/dockerfile:1.7

FROM debian:bookworm-slim AS scanners
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl tar unzip \
  && rm -rf /var/lib/apt/lists/*

ENV GITLEAKS_VERSION=8.24.2
ENV TRIVY_VERSION=0.60.0
ENV OSV_SCANNER_VERSION=2.0.0
ENV OPENGREP_VERSION=1.2.1

RUN curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
    | tar -xz -C /usr/local/bin gitleaks \
  && curl -fsSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" \
    | tar -xz -C /usr/local/bin trivy \
  && curl -fsSL "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64" \
    -o /usr/local/bin/osv-scanner \
  && chmod +x /usr/local/bin/osv-scanner \
  && (curl -fsSL "https://github.com/opengrep/opengrep/releases/download/v${OPENGREP_VERSION}/opengrep_manylinux_x86" \
      -o /usr/local/bin/opengrep && chmod +x /usr/local/bin/opengrep || true)

FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.21.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json turbo.json eslint.config.mjs ./
COPY scripts ./scripts
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile
RUN node scripts/check-no-ee.mjs
ENV UZINA_STANDALONE=1
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm turbo run build

FROM node:22-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1001 uzina \
  && useradd --uid 1001 --gid uzina --shell /bin/bash --create-home uzina

COPY --from=scanners /usr/local/bin/* /usr/local/bin/
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=builder /app/packages/skills ./packages/skills
COPY --from=builder /app/apps/cli/dist ./apps/cli/dist
COPY --from=builder /app/apps/cli/package.json ./apps/cli/package.json

RUN mkdir -p /data && chown -R uzina:uzina /app /data

USER uzina

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV UZINA_DATA_DIR=/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/web/server.js"]
