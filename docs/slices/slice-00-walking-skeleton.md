# Dossiê do Slice 0 — Walking Skeleton (Uzina Studio)

* **Status:** `Plan Gate EGM Aprovado (Pronto para Codificar)`
* **Branch:** `feat/slice-00-walking-skeleton`
* **Estratégia Aplicada:** *Contract-First + Walking Skeleton*
* **Spec de Referência:** `docs/especificacao-tecnica-fase-1-v1.1.md` (Seções 1, 3, 4, 5.1, 7.1 e 8) · `docs/adr/001-identidade-uzina-studio.md` · `docs/adr/002-persistencia-dual-mode-pglite-postgres.md`

---

## 1. Objetivo e Escopo Estrito

Construir o **Walking Skeleton** executável do **Uzina Studio**, validando de ponta a ponta a espinha dorsal do monorepo:
* Workspace `pnpm` (`12.21.0`) + Turborepo v2 (`"tasks"`) com TypeScript strict (`5.9.3`), ESLint flat config anti-`any` e governança anti-`ee/`.
* Pacote `@uzina/contracts` com `HealthPublicSchema`, `HealthDetailsSchema` e os enums centrais da Fase 1.
* Pacote `@uzina/db` com schema inicial compatível com Better Auth (`organizations`, `users`, `sessions`, `accounts`, `verifications`), migrações SQL geradas via `drizzle-kit generate` executadas automaticamente no cold start e fábrica dual-mode (`PGlite` local via `Symbol.for("@uzina/db/singleton")` ↔ `PostgreSQL` via `DATABASE_URL`).
* Aplicação `apps/web` (Next.js App Router `16.4.6`) com Better Auth (`1.7.27`) em `/api/auth/[...all]`, rota pública `GET /api/health`, rota autenticada `GET /api/health/details` e página inicial mínima de diagnóstico (`force-dynamic`).
* Infraestrutura dev (`docker-compose.dev.yml` com `pgvector/pgvector:pg16` + extensão `vector`) e comando raiz `pnpm verify`.

### Explicitamente Fora de Escopo (Slices Futuros)
* CRUD de Clientes/Projetos/Entregas, seed `"Internos"`, Cofre AES-256-GCM, Kanban/Sidebar, MSW e enums específicos das tabelas dos Slices 1–4 (`ProjectStatus`, `MemoryCategory`, `DesignAssetType`, `DecisionStatus`, `SecurityScanMode`, `PovTestStatus`, `ExecutionEventType`).
* `@uzina/core` (StateMachine/StuckDetector/TestAuditor — auditor estático de testes entra no Slice 4), `@uzina/opencode-bridge`, `@uzina/mastra-runtime` (e campo `mastraStore` ativo no health), `@uzina/security-engine` e `apps/cli`.

---

## 2. Fronteiras de Pacotes, Dependências Pinadas e Arquivos Previstos

Todas as dependências respeitam `.npmrc` (`save-exact=true`) e `workspace:*` entre pacotes internos compilados em `dist/` (`exports: { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`).

### Dependências Pinadas do Slice 0
* **Raiz (`devDependencies`):** `turbo@2.11.13`, `typescript@5.9.3`, `eslint@10.15.0`, `typescript-eslint@8.73.0`, `@types/node@26.6.6`, `vitest@5.1.1`.
* **`@uzina/contracts`:** `zod@4.6.7` (`devDependencies`: `vitest@5.1.1`, `typescript@5.9.3`) — **zero dependências internas**.
* **`@uzina/db`:** `@uzina/contracts@workspace:*`, `drizzle-orm@0.45.4`, `@electric-sql/pglite@0.5.17`, `pg@8.23.1` (`devDependencies`: `@types/pg@8.23.1`, `drizzle-kit@0.31.11`, `vitest@5.1.1`, `typescript@5.9.3`).
* **`apps/web` (`@uzina/web`):** `@uzina/contracts@workspace:*`, `@uzina/db@workspace:*`, `next@16.4.6`, `react@19.3.1`, `react-dom@19.3.1`, `better-auth@1.7.27`, `drizzle-orm@0.45.4` (`devDependencies`: `eslint-config-next@16.4.6`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `@types/node@26.6.6`, `vitest@5.1.1`, `typescript@5.9.3`).

### Arquivos a Criar / Configurar
* **Raiz:**
  * `package.json`: `"packageManager": "pnpm@12.21.0"`, `"verify": "node scripts/check-no-ee.mjs && pnpm turbo run typecheck lint build test"`, além de `"typecheck"`, `"lint"`, `"build"`, `"test"`, `"check:no-ee"`. *(Nota: o auditor estático `test-auditor.ts` será encadeado no `verify` a partir do Slice 4.)*
  * `pnpm-workspace.yaml`: `packages: ["apps/*", "packages/*"]`.
  * `turbo.json` (Turborepo v2 `"tasks"`):
    * `build`: `dependsOn: ["^build"]`, `outputs: [".next/**", "!.next/cache/**", "dist/**"]`
    * `typecheck`: `dependsOn: ["^build"]`
    * `lint`: `dependsOn: ["^build"]`
    * `test`: `dependsOn: ["^build"]`, `passThroughEnv: ["DATABASE_URL", "TEST_DATABASE_URL", "UZINA_DATA_DIR", "FACTORY_DATA_DIR", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "UZINA_STRICT_SECRETS", "NODE_ENV", "NEXT_PHASE"]`
  * `tsconfig.base.json`: `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "bundler"`, `strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: false`, `skipLibCheck: true`.
  * `eslint.config.mjs`: flat config com `typescript-eslint`, `@typescript-eslint/no-explicit-any: "error"`, regra `no-restricted-syntax` proibindo `as unknown as` (`TSAsExpression` sobre `TSUnknownKeyword`), e `eslint-config-next` aplicado a `apps/web`.
  * `docker-compose.dev.yml` + `scripts/postgres-init/01-pgvector.sql`: imagem `pgvector/pgvector:pg16`, porta `5432`, `POSTGRES_USER=uzina`, `POSTGRES_PASSWORD=uzina`, `POSTGRES_DB=uzina_dev`, `healthcheck` via `pg_isready`, init executando `CREATE EXTENSION IF NOT EXISTS vector;`. (`TEST_DATABASE_URL=postgres://uzina:uzina@localhost:5432/uzina_dev`).
* **`packages/contracts` (`@uzina/contracts`):**
  * `package.json`, `tsconfig.json`, `vitest.config.ts`
  * `src/enums.ts`, `src/health.ts`, `src/index.ts` (exportando schemas e tipos `z.infer`)
  * `tests/contracts.test.ts`
* **`packages/db` (`@uzina/db`):**
  * `package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.setup.ts` (`UZINA_DATA_DIR=":memory:"`), `drizzle.config.ts` (`dialect: "postgresql"`, `schema: "./src/schema/index.ts"`, `out: "./drizzle"`)
  * `drizzle/` (migração SQL inicial gerada via `drizzle-kit generate`)
  * `src/schema/auth.ts`, `src/schema/index.ts`, `src/client.ts`, `src/health.ts`, `src/index.ts`
  * `tests/dual-mode.test.ts`, `tests/pglite-integration.test.ts`, `tests/postgres-live.test.ts`
* **`apps/web` (`@uzina/web`):**
  * `package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.setup.ts` (`UZINA_DATA_DIR=":memory:"`)
  * `next.config.ts`: `serverExternalPackages: ["@electric-sql/pglite", "pg"]` + `outputFileTracingIncludes` para incluir WASM/data do `@electric-sql/pglite` e `packages/db/drizzle/**`.
  * `src/lib/auth.ts` (singleton lazy `getAuth()`, evitando validação em build-time)
  * `src/app/api/auth/[...all]/route.ts` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`, `toNextJsHandler(getAuth())`)
  * `src/lib/health-service.ts` (fábrica pura de health check com timeout `<= 2000ms`)
  * `src/app/api/health/route.ts` (público — retorna `HealthPublicSchema`)
  * `src/app/api/health/details/route.ts` (autenticado via `getAuth().api.getSession()` — retorna `HealthDetailsSchema`)
  * `src/app/page.tsx` (`export const dynamic = "force-dynamic"`, `export const runtime = "nodejs"` — exibe status público sem segredos)
  * `tests/health-route.test.ts`, `tests/auth-route.test.ts`

---

## 3. Contratos Compartilhados (`@uzina/contracts`)

### `src/enums.ts` (cada schema acompanha `export type <Nome> = z.infer<typeof <Nome>Schema>`)
* `DatabaseModeSchema`: `z.enum(["pglite", "postgres"])`
* `DevelopmentStrategySchema`: `z.enum(["frontend_first_msw", "api_contract_first", "domain_first", "data_schema_first", "characterization_strangler", "spike_first"])`
* `DeliverableStatusSchema`: `z.enum(["discovery", "spec_review", "visual_studio", "contract_tests", "building", "verifying", "decision_pending", "approved", "merged", "failed", "paused"])`
* `TacticalPatternSchema`: `z.enum(["single_agent", "split_lanes", "best_of_n", "council"])`
* `RiskLevelSchema`: `z.enum(["low", "medium", "high"])`
* `ProviderTypeSchema`: `z.enum(["omniroute", "openai_compatible", "anthropic", "google", "ollama"])`
* `MemoryScopeSchema`: `z.enum(["org", "client", "project"])`
* `DecisionTypeSchema`: `z.enum(["discovery_confirm", "blueprint_approve", "visual_approve", "pr_evidence_approve", "stuck_intervention"])`
* `SecuritySeveritySchema`: `z.enum(["critical", "high", "medium", "low", "info"])`
* `TriageVerdictSchema`: `z.enum(["pending", "confirmed", "false_positive", "unknown"])`

### `src/health.ts`
* **`HealthPublicSchema`** (usado por `GET /api/health` público — zero exposição de infraestrutura):
  * `status`: `z.enum(["ok", "error"])`
  * `service`: `z.literal("uzina-studio")`
  * `timestamp`: `z.string().datetime()`
* **`ServiceCheckSchema`**:
  * `status`: `z.enum(["up", "down", "not_configured"])`
  * `latencyMs`: `z.number().nonnegative().optional()`
* **`HealthDetailsSchema`** (usado por `GET /api/health/details` autenticado — já prevê `mastraStore` e `llmGateway` opcionais da Spec §5.1 para Slices 1 e 3 sem *breaking change*):
  * `status`: `z.enum(["ok", "degraded", "error"])`
  * `service`: `z.literal("uzina-studio")`
  * `version`: `z.string().min(1)` (resolvido via `process.env.npm_package_version ?? "0.1.0"`)
  * `timestamp`: `z.string().datetime()`
  * `checks`:
    * `database`: `{ status: z.enum(["up", "down"]), mode: DatabaseModeSchema, latencyMs: z.number().nonnegative(), errorCode: z.string().optional() }`
    * `auth`: `{ status: z.enum(["configured", "ephemeral_dev"]) }`
    * `mastraStore`: `ServiceCheckSchema.optional()`
    * `llmGateway`: `ServiceCheckSchema.optional()`
* **Regra de status de `HealthDetailsSchema`:** `database.status === "down"` → `"error"` (HTTP `503`); `database.status === "up"` e checks opcionais ausentes/saudáveis → `"ok"` (HTTP `200`); check opcional `"down"` → `"degraded"` (HTTP `200`).

---

## 4. Persistência, Better Auth, Segurança e Decisões Técnicas

1. **Assinaturas e Seleção Dual-Mode (`packages/db/src/client.ts`):**
   ```ts
   export interface DatabaseConfig {
     mode: DatabaseMode; // "pglite" | "postgres"
     connectionString?: string;
     dataDir?: string; // ":memory:" ou caminho resolvido em disco
   }
   export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string;
   export function resolveDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig;
   export function getDb(options?: { dataDir?: string }): Promise<UzinaDbContext>;
   export function checkDbHealth(timeoutMs?: number): Promise<{ status: "up" | "down"; mode: DatabaseMode; latencyMs: number; errorCode?: string }>;
   export function closeDb(): Promise<void>;
   ```
   * `resolveDataDir(env)`: retorna `env.UZINA_DATA_DIR?.trim() || env.FACTORY_DATA_DIR?.trim() || "./data"`. Se não for `":memory:"` e o caminho absoluto contiver `"OneDrive"`, emite `console.warn` único no startup alertando sobre possíveis locks NTFS.
   * `resolveDatabaseConfig(env)`: quando `DATABASE_URL` é `undefined` ou `.trim() === ""` → `{ mode: "pglite", dataDir }`. Quando preenchida, valida URI via `new URL(raw)` exigindo protocolo `postgres:` ou `postgresql:`; caso inválida, lança `Error` **fail-fast** explícito (proibido fallback silencioso para PGlite).
   * Singleton armazenado em `(globalThis as Record<symbol, unknown>)[Symbol.for("@uzina/db/singleton")]`. Se `initPromise` rejeitar, `.catch()` zera `singleton.initPromise = undefined` para permitir auto-recuperação. Registra `SIGINT`/`SIGTERM` idempotentes invocando `closeDb()`.
   * **Migrações Automáticas no `initPromise`:** executa `migratePglite(db, { migrationsFolder })` (`drizzle-orm/pglite/migrator`) ou `migrateNodePg(db, { migrationsFolder })` (`drizzle-orm/node-postgres/migrator`, sob `pg_advisory_lock(847291)`), com `migrationsFolder` resolvido via `fileURLToPath(new URL("../drizzle", import.meta.url))`.

2. **Schema Drizzle (`packages/db/src/schema/auth.ts`) & Better Auth (`apps/web/src/lib/auth.ts`):**
   * Todas as PKs e FKs são **`uuid`** (`uuid("id").primaryKey().defaultRandom()`), com timestamps `timestamp(..., { withTimezone: true }).defaultNow().notNull()`:
     * `organizations`: `id`, `name`, `slug` (unique), `createdAt`, `updatedAt`.
     * `users`: `id`, `name`, `email` (unique), `emailVerified` (`boolean().default(false).notNull()`), `image` (`text`), `organizationId` (`uuid("organization_id").references(() => organizations.id, { onDelete: "set null" })` — **nullable** no Slice 0 para compatibilidade com `signUpEmail` antes do seed/onboarding do Slice 1), `createdAt`, `updatedAt`.
     * `sessions`: `id`, `expiresAt`, `token` (unique), `ipAddress`, `userAgent`, `userId` (`uuid` FK cascade -> `users.id`), `createdAt`, `updatedAt`.
     * `accounts`: `id`, `accountId`, `providerId`, `userId` (`uuid` FK cascade -> `users.id`), `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `scope`, `password`, `createdAt`, `updatedAt`.
     * `verifications`: `id`, `identifier`, `value`, `expiresAt`, `createdAt`, `updatedAt`.
   * Configuração Better Auth (instanciada de forma **lazy** por `getAuth()` em runtime, nunca durante `NEXT_PHASE === "phase-production-build"`):
     ```ts
     betterAuth({
       database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),
       emailAndPassword: { enabled: true },
       advanced: { database: { generateId: "uuid" } },
       secret: resolveAuthSecret(),
       baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
       basePath: "/api/auth",
       plugins: [nextCookies()],
     });
     ```

3. **Gestão de `BETTER_AUTH_SECRET` e Segurança de `/api/health`:**
   * Se `DATABASE_URL` estiver preenchida ou `UZINA_STRICT_SECRETS === "true"`, exige `BETTER_AUTH_SECRET` >= 32 caracteres em runtime (*fail-fast*).
   * No modo local zero-config (`!DATABASE_URL`), se `BETTER_AUTH_SECRET` estiver ausente: em `:memory:` usa segredo em `globalThis`; em disco gera uma única vez e grava de forma atômica (`flag: "wx"`, `mode: 0o600`) em `${dataDir}/.auth-secret`.
   * `GET /api/health`: público, timeout `2000ms` (`connectionTimeoutMillis: 2000` + `Promise.race`), responde apenas `HealthPublicSchema` (`200` ou `503`), sem stack trace nem `err.message`.
   * `GET /api/health/details`: exige sessão válida (`getAuth().api.getSession({ headers: request.headers })`); sem sessão retorna `401 Unauthorized`.

---

## 5. Plano de Testes (*Spec → Teste* antes do Build)

1. **Unitários em `@uzina/contracts` (`tests/contracts.test.ts` — `test.each`):**
   * Validação positiva e rejeição de fronteiras inválidas para `HealthPublicSchema`, `HealthDetailsSchema` (`latencyMs: -1`, `timestamp` inválido, `status` desconhecido) e os 10 enums base.
2. **Dual-Mode & Banco Real em `@uzina/db` (`vitest.setup.ts` seta `UZINA_DATA_DIR=":memory:"`):**
   * `tests/dual-mode.test.ts` (`test.each`): valida `resolveDatabaseConfig` para `DATABASE_URL` ausente, vazia (`"   "`), `postgres://...`, `postgresql://...`, e **lançamento de erro fail-fast** para URLs preenchidas inválidas (`"mysql://..."`, `"not-a-url"`), além da precedência `UZINA_DATA_DIR` → `FACTORY_DATA_DIR` → `"./data"`.
   * `tests/pglite-integration.test.ts`: abre PGlite `:memory:`, valida que as migrações automáticas criaram as 5 tabelas, insere `organizations` + `users` com FK válida, valida retorno UUID, comprova singleton `Symbol.for("@uzina/db/singleton")` em chamadas repetidas de `getDb()`, testa persistência real em diretório temporário exclusivo (`fs.mkdtempSync(os.tmpdir()...)`) e encerra com `afterAll(() => closeDb())`.
   * `tests/postgres-live.test.ts`: `describe.skipIf(!process.env.TEST_DATABASE_URL)` executa migrações, checa extensão `vector` (`pg_extension`), valida `checkDbHealth()`, grava/lê e limpa registros de teste (*nunca* reporta falso verde se `TEST_DATABASE_URL` estiver ausente).
3. **Integração HTTP em `apps/web`:**
   * `tests/health-route.test.ts`:
     * `GET /api/health` conectado ao `@uzina/db` (`:memory:`) retorna `200` validado por `HealthPublicSchema.parse(body)`.
     * `GET /api/health/details` sem sessão retorna `401`.
     * Cenário `503` (via injeção de `createHealthGetHandler({ probe })` com timeout/falha simulada na função de probe — sem `vi.mock("@uzina/db")`) retorna `503` com `status: "error"` e zero vazamento de strings internas/credenciais.
   * `tests/auth-route.test.ts`: contra PGlite `:memory:`, executa `POST /api/auth/sign-up/email` → valida criação real nas tabelas `users` e `sessions` (UUIDs válidos) → `GET /api/auth/get-session` com cookie retornado → `GET /api/health/details` autenticado retorna `200` validado por `HealthDetailsSchema.parse(body)`.

---

## 6. Critérios de Pronto (DoD)
* [ ] `node scripts/check-no-ee.mjs` retorna código `0`.
* [ ] `pnpm verify` executa `check-no-ee` + `typecheck` + `lint` + `build` + `test` e termina com código `0`.
* [ ] `apps/web` compila sem secrets definidos no ambiente de build (`next build` verde).
* [ ] `GET /api/health` responde `200` válido contra `HealthPublicSchema`; `sign-up` + `get-session` + `/api/health/details` passam em integração real com PGlite.
* [ ] `docker-compose.dev.yml` presente e documentado para subida de PostgreSQL + `pgvector`.
* [ ] Revisões `test-critic`, `appsec-auditor`, `factory-verifier` e `egm-codebase-details` concluídas sem pendências bloqueantes.

---

## 7. Revisão EGM Pré-Código (Plan Gate)

Auditado em paralelo por **`egm-implementation-readiness`** (6 BLOCKERs, 5 WARNINGs) e **`egm-design`** (4 CRITICAL, 4 HIGH, 2 MEDIUM). Todos os apontamentos foram incorporados nesta versão final do dossiê:
* **Better Auth + Drizzle + UUID (`BLOCKER #1 / CRITICAL #4`):** travados `uuid` PKs/FKs, `usePlural: true`, `generateId: "uuid"`, `organizationId` nullable no Slice 0 e `tests/auth-route.test.ts`.
* **Migrações Automáticas (`BLOCKER #2 / CRITICAL #3`):** `drizzle-kit generate` em `packages/db/drizzle/` + `migrate()` idempotente na `initPromise` (com `pg_advisory_lock` no Postgres).
* **Singleton, Anti-Poisoned Promise & Fail-Fast (`BLOCKER #3 / HIGH #5 / MEDIUM #9`):** chave única `Symbol.for("@uzina/db/singleton")`, reset de `initPromise` no `.catch()`, hooks `SIGINT`/`SIGTERM`, e erro *fail-fast* para `DATABASE_URL` preenchida inválida.
* **Next.js + PGlite WASM + `next build` (`BLOCKER #4,#5 / CRITICAL #1,#2`):** `serverExternalPackages`, `force-dynamic`, `runtime = "nodejs"`, `getAuth()` lazy (sem validar secrets em `phase-production-build`) e persistência local `.auth-secret` (`wx`/`0600`).
* **Superfície `/api/health` & Isolamento de Testes (`BLOCKER #6 / HIGH #6,#7,#8 / WARNING #7-#11`):** divisão entre `/api/health` público mínimo (`timeout <= 2000ms`) e `/api/health/details` autenticado (prevendo `mastraStore`/`llmGateway` opcionais); `vitest.setup.ts` com `UZINA_DATA_DIR=":memory:"`; versões exatas verificadas (`typescript@5.9.3`, `zod@4.6.7`, `next@16.4.6`, `better-auth@1.7.27`, `drizzle-orm@0.45.4`, `@electric-sql/pglite@0.5.17`).

---

## 8. Evidências Reais Pós-Código (Verify Gate)
*(Preencher somente após a implementação do Slice 0.)*
