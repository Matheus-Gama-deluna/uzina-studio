# syntax=docker/dockerfile:1.7

FROM debian:bookworm-slim AS scanners
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl tar \
  && rm -rf /var/lib/apt/lists/*

ENV GITLEAKS_VERSION=8.24.2 \
    GITLEAKS_SHA256=fa0500f6b7e41d28791ebc680f5dd9899cd42b58629218a5f041efa899151a8e \
    TRIVY_VERSION=0.76.2 \
    TRIVY_SHA256=bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf \
    OSV_SCANNER_VERSION=2.0.0 \
    OSV_SCANNER_SHA256=b60c273474aecad1158cfe1e9828f3841483701ba0fe3560517a45b2db16e84c \
    OPENGREP_VERSION=2.0.0 \
    OPENGREP_SHA256=37e93f4da5fd04a18c5c1febbdd12f7e98dfccd4d0c9cf2593bcb25eeb462da0

RUN set -eu; \
  curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" -o /tmp/gitleaks.tar.gz; \
  echo "${GITLEAKS_SHA256}  /tmp/gitleaks.tar.gz" | sha256sum -c -; \
  tar -xz -f /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks; \
  curl -fsSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" -o /tmp/trivy.tar.gz; \
  echo "${TRIVY_SHA256}  /tmp/trivy.tar.gz" | sha256sum -c -; \
  tar -xz -f /tmp/trivy.tar.gz -C /usr/local/bin trivy; \
  curl -fsSL "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64" -o /usr/local/bin/osv-scanner; \
  echo "${OSV_SCANNER_SHA256}  /usr/local/bin/osv-scanner" | sha256sum -c -; \
  curl -fsSL "https://github.com/opengrep/opengrep/releases/download/v${OPENGREP_VERSION}/opengrep_linux_x86" -o /usr/local/bin/opengrep; \
  echo "${OPENGREP_SHA256}  /usr/local/bin/opengrep" | sha256sum -c -; \
  chmod 0755 /usr/local/bin/gitleaks /usr/local/bin/trivy /usr/local/bin/osv-scanner /usr/local/bin/opengrep; \
  rm -f /tmp/gitleaks.tar.gz /tmp/trivy.tar.gz

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

COPY --from=scanners /usr/local/bin/gitleaks /usr/local/bin/gitleaks
COPY --from=scanners /usr/local/bin/trivy /usr/local/bin/trivy
COPY --from=scanners /usr/local/bin/osv-scanner /usr/local/bin/osv-scanner
COPY --from=scanners /usr/local/bin/opengrep /usr/local/bin/opengrep
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=builder /app/packages/skills ./packages/skills
COPY --from=builder /app/packages/security-engine/rules ./packages/security-engine/rules
COPY --from=builder /app/apps/cli/dist ./apps/cli/dist
COPY --from=builder /app/apps/cli/package.json ./apps/cli/package.json

RUN mkdir -p /data /data/trivy-cache /app/apps/web/.next/cache \
  && chown -R root:uzina /app \
  && chmod -R g+rX,o-w /app \
  && chown -R uzina:uzina /data /app/apps/web/.next/cache

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
