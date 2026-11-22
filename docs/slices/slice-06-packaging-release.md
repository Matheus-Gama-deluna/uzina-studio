# Dossiê do Slice 6 — Empacotamento, Migração & Release (`npx` + Docker + Playwright E2E)

* **Status:** `Concluído`
* **Branch:** `feat/slice-06-packaging-release`
* **Marco:** ★ **Fase 1 (MVP) Completa**
* **Estratégia Aplicada:** *Release Engineering + Dual-Mode Migration + End-to-End Verification*
* **Spec de Referência:** `docs/especificacao-tecnica-fase-1-v1.1.md` (Seções 2, 3, 4, 7, 8)

---

## 1. Objetivo e Escopo Estrito
Entregar o empacotamento completo de produção da **Fase 1 do Uzina Studio**:
1. Motor idempotente de migração PGlite → PostgreSQL (`@uzina/db/src/migrate-to-postgres.ts`) cobrindo todas as 16 tabelas Drizzle em ordem topológica de chaves estrangeiras, dentro de transação única no destino, com redação estrita de credenciais e validação de contagem por tabela.
2. CLI unificada `apps/cli` (`@uzina/cli`, binários `uzina` e `uzina-studio`):
   - `uzina start` / `uzina dev` (processo único PGlite + suporte `--dry-run`)
   - `uzina sec <scan|doctor|install-tools>` (100% *stateless*, delegando para `@uzina/security-engine`)
   - `uzina db migrate-to-postgres --from <dataDir> --to <DATABASE_URL> [--dry-run]`
   - `uzina doctor [--json]`
3. Empacotamento Docker & Compose: `output: "standalone"` condicional (`UZINA_STANDALONE=1`), `.dockerignore`, `Dockerfile` multi-stage (`node:22-slim`, 4 scanners AppSec pré-instalados, usuário não-root `uzina`) e `docker-compose.yml` (`pgvector/pgvector:pg16` + `uzina`).
4. CI/CD GitHub Actions (`.github/workflows/ci.yml` + `.github/workflows/release.yml`).
5. Suíte Playwright E2E (`apps/web/e2e/smoke.spec.ts` + `playwright.config.ts`) + `README.md` atualizado.

## 2. Fronteiras & Invariantes
- `uzina sec` nunca chama `getDb()` em modo PGlite local (regra de processo único).
- `DATABASE_URL` é validada (`postgres://` ou `postgresql://`) e sua senha/userinfo são sempre mascarados em logs e stdout (`redactDatabaseUrl`).
- `output: "standalone"` no `apps/web/next.config.ts` é ativado exclusivamente com `UZINA_STANDALONE=1` para manter `next start` local/Playwright limpo.

## 3. Critérios de Pronto (DoD)
- [x] `node scripts/check-no-ee.mjs` e `node scripts/audit-tests.mjs` retornam código `0`.
- [x] `pnpm turbo run build --force` (8/8 pacotes) e `pnpm turbo run typecheck lint test --force` verdes sem cache.
- [x] `migrateDatabaseData` validado com dados reais + reexecução idempotente + mascaramento de `DATABASE_URL`.
- [x] `apps/cli` testado para `start --dry-run`, `dev --dry-run`, `doctor --json`, `sec`, `db migrate-to-postgres` e flags inválidas.
- [x] `pnpm --filter @uzina/web test:e2e` (Playwright Chromium ponta a ponta) verde sem erros de console ou HTTP `>=500`.
- [x] Build `UZINA_STANDALONE=1` validado e artefatos de fase atualizados como **Marco Fase 1 Completa**.

## 4. Evidências Reais Pós-Código (Verify Gate + Docker & Postgres Live + Revisões)
- `node scripts/check-no-ee.mjs`: exit `0` (`OK [check-no-ee]`).
- `pnpm turbo run build --force`: **8/8 packages** (`0 cached`, 0 warnings no Next.js 16.4.6 Turbopack; inclui `turbo.json` com `env`/`passThroughEnv` de `UZINA_STANDALONE`).
- `node scripts/audit-tests.mjs`: `[audit:tests] Arquivos: 43 | Testes: 155 | Suprimidos: 2 | Violações: 0`.
- `pnpm turbo run typecheck lint test --force` com `TEST_DATABASE_URL` contra `pgvector/pgvector:pg16` real: **30/30 tasks** (`0 cached`):
  - `@uzina/contracts`: `6` files, `115 passed`
  - `@uzina/core`: `11` files, `137 passed`
  - `@uzina/security-engine`: `3` files, `19 passed`
  - `@uzina/cli`: `1` file, `12 passed`
  - `@uzina/opencode-bridge`: `3` files, `45 passed`
  - `@uzina/db`: `8` files, **`35 passed | 0 skipped`** (`postgres-live.test.ts` executou migrações, extensão `vector`, CRUD e healthcheck `mode: "postgres"`; `slice6-migrate-to-postgres.test.ts` com 9 testes incluindo batching e rollback transacional)
  - `@uzina/mastra-runtime`: `4` files, `15 passed`
  - `@uzina/web`: `7` files, `24 passed`
  - Total Vitest: **402 passed | 0 skipped**
- Playwright E2E (`pnpm --filter @uzina/web test:e2e`): **2 passed (11.2s)** em Chromium headless contra servidor de produção (`GET /api/health` + signup -> projeto -> entrega -> headings de `/app/providers`, `/app/decisions`, `/app/security`, `/app/memories` -> Co-piloto SSE com 0 console errors, 0 pageerrors, 0 HTTP `>=500`, 0 overflow horizontal).
- **Migração CLI Live (`node apps/cli/dist/index.js db migrate-to-postgres`):** executada 2x contra `pgvector:pg16` (`127.0.0.1:5432`) com `"verified": true`, `totalSourceRows: 5`, `totalTargetRows: 5`, idempotência confirmada e senha mascarada (`postgresql://***:***@127.0.0.1:5432/uzina_dev`).
- **Docker Multi-Stage & Full-Stack (`Dockerfile` + `docker-compose.yml`):**
  - Imagem construída e validada com usuário não-root `uzina` (UID `1001`), `/app` somente leitura + `/data` gravável, `cap_drop: ALL`, `no-new-privileges:true` e verificação `sha256sum -c` dos 4 scanners (`gitleaks 8.24.2`, `trivy 0.76.2`, `osv-scanner 2.0.0`, `opengrep 2.0.0`).
  - Stack `docker-compose.yml` (`uzina-postgres` + `uzina-studio`): ambos `healthy`, fluxo ponta a ponta validado com `/api/health`, signup Better Auth, `/api/health/details` (`checks.database.mode === "postgres"`, `status === "up"`), criação de projeto/memória e SSE do Co-piloto (`DOCKER_FULLSTACK_E2E_OK`).
- **Revisões:** `appsec-auditor` (achados HIGH/MEDIUM/LOW corrigidos), `test-critic` (apontamentos sanados em todos os arquivos + correção final em `slice4-api.test.ts`), `factory-verifier`: **PASS**.
- CLI (`node apps/cli/dist/index.js`): `--version` (`uzina-studio v0.1.0`), `start --dry-run` e `doctor --json` validados com exit `0`.
