# Dossiê do Slice 1 — Hierarquia, Cofre AES-256-GCM & UI com MSW (Uzina Studio)

* **Status:** `Concluído (Verify Gate + QA Visual Multi-Viewport + Factory Verifier PASS)`
* **Branch:** `feat/slice-01-hierarchy-vault-ui`
* **Estratégia Aplicada:** *Frontend-First (MSW) + Domain-First (TDD)*
* **Spec de Referência:** `docs/especificacao-tecnica-fase-1-v1.1.md` (Seções 3, 4.2, 4.3, 5.1, 5.2, 6.2 e 8) · `.uzina/DESIGN.md` · `docs/adr/003-design-system-oklch-anti-ai-slop.md`

---

## 1. Objetivo e Escopo Estrito

Entregar a espinha operacional e visual do **Uzina Studio** sobre o Walking Skeleton do Slice 0:
* **Domínio & Segurança (`@uzina/core`):** Cofre criptográfico **AES-256-GCM** (IV 12 bytes, AuthTag 16 bytes, AAD `${organizationId}:${providerType}`, `MasterKeyInputSchema` Zod, `maskApiKey`, `resolveMasterKey`) + Máquina de Estados determinística de `DeliverableStatus` (Spec §6.2, incluindo `paused` e `pausedFromStatus`).
* **Contratos (`@uzina/contracts`):** Schemas Zod completos e tipos `z.infer` para `clients`, `projects`, `project_repositories`, `deliverables`, `provider_profiles` (DTO público estrito sem `encryptedApiKey`/`apiKey`) e `ApiErrorSchema`.
* **Persistência (`@uzina/db`):** 5 novas tabelas Drizzle `pg-core`, migração SQL `0001` e seed transacional idempotente do cliente `"Internos"` (`isDefaultInternal: true`).
* **APIs RBAC + MSW + Contract Drift (`apps/web`):** Endpoints `/api/clients`, `/api/projects`, `/api/projects/[id]/repositories`, `/api/projects/[id]/deliverables`, `/api/deliverables/[id]` e `/api/providers` com validação Zod, isolamento multi-tenant via `INNER JOIN` até `organizationId`, MSW dual (`setupServer` + `setupWorker` com `public/mockServiceWorker.js`) e Contract Drift Check cruzado contra rotas reais em PGlite.
* **Cockpit UI Anti-"AI Slop" (`apps/web`):** Tailwind CSS v4 (`@theme inline` OKLCH Dark Industrial padrão + `[data-theme="light"]` anti-FOUC), fontes `Geist` + `Geist_Mono`, Radix Dialog (`@radix-ui/react-dialog`), telas `/login` (Entrar + Criar conta), `/app` (Torre de Controle com Kanban Vivo + Lista Hierárquica alternáveis em 1 clique), `/app/providers` (Cofre mascarado + `role_bindings`), paleta `Cmd+K`, 5 estados obrigatórios e QA Visual multi-viewport no `browser`.

### Explicitamente Fora de Escopo (Slices Futuros)
* `@uzina/opencode-bridge`, Git worktrees locais e `StuckDetector` (Slice 2).
* `@uzina/mastra-runtime`, `deliverableLifecycleWorkflow`, Estúdio Visual Lite (`design_assets`), upload `/api/assets/:id` (Slice 3).
* `@uzina/security-engine`, auditor estático `test-auditor.ts`, Caixa de Decisões HITL (`decisions`) e `execution_events` (Slice 4).
* Co-piloto Executivo (`.network()` / drawer chat SSE) e `memories` (Slice 5).
* `apps/cli` (`uzina start`, `migrate-to-postgres`), Dockerfile e suíte Playwright E2E completa (Slice 6).

---

## 2. Fronteiras de Pacotes, Dependências Pinadas e Arquivos Previstos

* **`@uzina/contracts` (`packages/contracts` — ZERO deps internas):**
  * `src/enums.ts` (+ `ProjectStatusSchema`, `AgentRoleSchema`), `src/errors.ts` (`ApiErrorSchema`)
  * `src/clients.ts`, `src/projects.ts`, `src/deliverables.ts`, `src/providers.ts`, `src/index.ts`
  * `tests/slice1-contracts.test.ts`
* **`@uzina/core` (`packages/core` — importa APENAS `@uzina/contracts`):**
  * `package.json` (`zod@4.6.7`, `@uzina/contracts@workspace:*`, `typescript@5.9.3`, `vitest@5.1.1`, `@types/node@26.6.6`), `tsconfig.json`, `vitest.config.ts`
  * `src/vault.ts`, `src/state-machine.ts`, `src/index.ts`
  * `tests/vault.test.ts`, `tests/state-machine.test.ts`
* **`@uzina/db` (`packages/db` — importa APENAS `@uzina/contracts`):**
  * `src/schema/workspace.ts` (`clients`, `projects`, `projectRepositories`, `deliverables`, `providerProfiles`), `src/schema/index.ts`
  * `src/seed.ts` (`ensureDefaultOrgAndInternalClient`), `src/index.ts`
  * `drizzle/0001_*.sql` (gerada via `drizzle-kit generate`)
  * `tests/workspace-schema.test.ts`
* **`apps/web` (`@uzina/web` — importa `@uzina/contracts`, `@uzina/core`, `@uzina/db`):**
  * Novas deps exatas (`save-exact=true`): `@uzina/core@workspace:*`, `zod@4.6.7`, `lucide-react@1.77.0`, `@tanstack/react-query@5.108.2`, `clsx@2.1.1`, `tailwind-merge@3.7.1`, `@radix-ui/react-dialog@1.3.1`, `tailwindcss@4.3.5`, `@tailwindcss/postcss@4.3.5`, `msw@3.0.7`.
  * `postcss.config.mjs`, `public/mockServiceWorker.js`
  * `src/lib/rbac.ts`, `src/lib/vault.ts`
  * `src/app/api/clients/route.ts`, `src/app/api/clients/[id]/route.ts`
  * `src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`, `src/app/api/projects/[id]/repositories/route.ts`
  * `src/app/api/projects/[id]/deliverables/route.ts`, `src/app/api/deliverables/[id]/route.ts`
  * `src/app/api/providers/route.ts`, `src/app/api/providers/[id]/route.ts`
  * `src/mocks/fixtures.ts`, `src/mocks/handlers.ts`, `src/mocks/server.ts`, `src/mocks/browser.ts`
  * `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/login/page.tsx`
  * `src/app/app/layout.tsx`, `src/app/app/page.tsx`, `src/app/app/providers/page.tsx`
  * `src/components/msw-provider.tsx`, `src/components/query-provider.tsx`, `src/components/theme-toggle.tsx`, `src/components/command-palette.tsx`, `src/components/cockpit-shell.tsx`, `src/components/workspace-board.tsx`, `src/components/providers-manager.tsx`
  * `tests/contract-drift.test.ts`, `tests/slice1-api.test.ts`

---

## 3. Contratos Compartilhados (`@uzina/contracts`) e API REST

### Schemas & Enums
* `ProjectStatusSchema = z.enum(["active", "archived"])`
* `AgentRoleSchema = z.enum(["discovery", "architect", "visual", "builder", "verifier", "security", "copilot"])`
* `ApiErrorSchema = z.object({ error: z.string().min(1), code: z.string().min(1).optional(), details: z.record(z.string(), z.unknown()).optional() })`
* `ProviderProfilePublicSchema` usa `.strict()` com `hasApiKey: z.boolean()` e `keyPreview: z.string().nullable()` — nunca aceita nem retorna `apiKey` ou `encryptedApiKey`.
* `UpdateProviderProfileSchema` omite `providerType` (imutável após criação para preservar o AAD criptográfico `${organizationId}:${providerType}`).

### Tabela de Endpoints REST (todos `runtime = "nodejs"`, `dynamic = "force-dynamic"`)

| Método & Rota | Request (Zod) | Response (Zod) | Status HTTP |
| :--- | :--- | :--- | :--- |
| `GET /api/clients` | — | `ClientListResponseSchema` | `200`, `401`, `403` |
| `POST /api/clients` | `CreateClientSchema` | `ClientSchema` | `201`, `400`, `401`, `403`, `409` |
| `PATCH /api/clients/[id]` | `UpdateClientSchema` | `ClientSchema` | `200`, `400`, `401`, `403`, `404`, `409` |
| `GET /api/projects` | Query `?clientId=` opcional | `ProjectListResponseSchema` | `200`, `401`, `403` |
| `POST /api/projects` | `CreateProjectSchema` | `ProjectSchema` | `201`, `400`, `401`, `403`, `404`, `409` |
| `PATCH /api/projects/[id]` | `UpdateProjectSchema` | `ProjectSchema` | `200`, `400`, `401`, `403`, `404`, `409` |
| `POST /api/projects/[id]/repositories` | `CreateProjectRepositorySchema` | `ProjectRepositorySchema` | `201`, `400`, `401`, `403`, `404` |
| `GET /api/projects/[id]/deliverables` | — | `DeliverableListResponseSchema` | `200`, `401`, `403`, `404` |
| `POST /api/projects/[id]/deliverables` | `CreateDeliverableSchema` | `DeliverableSchema` | `201`, `400`, `401`, `403`, `404` |
| `PATCH /api/deliverables/[id]` | `UpdateDeliverableSchema` | `DeliverableSchema` | `200`, `400`, `401`, `403`, `404`, `422` |
| `GET /api/providers` | — | `ProviderProfileListResponseSchema` | `200`, `401`, `403` |
| `POST /api/providers` | `CreateProviderProfileSchema` | `ProviderProfilePublicSchema` | `201`, `400`, `401`, `403` |
| `PATCH /api/providers/[id]` | `UpdateProviderProfileSchema` | `ProviderProfilePublicSchema` | `200`, `400`, `401`, `403`, `404` |

---

## 4. Domínio (`@uzina/core`), Persistência (`@uzina/db`), RBAC & UI

### 4.1 Cofre AES-256-GCM e Máquina de Estados (`@uzina/core`)
* **Vault (`src/vault.ts`):**
  * `MasterKeyInputSchema`: valida chave hex de 64 chars ou base64 decodificando para exatos `32` bytes.
  * `resolveMasterKey(env, dataDir)`: prioriza `MASTER_ENCRYPTION_KEY`, fallback `VAULT_MASTER_KEY`; se `DATABASE_URL` ou `UZINA_STRICT_SECRETS === "true"` e ausente → erro *fail-fast* (exceto `NEXT_PHASE === "phase-production-build"` via wrapper em `apps/web/src/lib/vault.ts`); em PGlite local sem env, usa `globalThis` (`:memory:`) ou grava `${dataDir}/.master-key` atômicamente (`flag: "wx"`, `mode: 0o600`).
  * `encryptSecret` / `decryptSecret`: `aes-256-gcm` (`node:crypto`), IV 12 bytes, AuthTag 16 bytes, AAD `${organizationId}:${providerType}`, formato `v1:<ivHex>:<tagHex>:<cipherHex>`.
  * `maskApiKey`: exibe últimos 4 caracteres (`sk-...xxxx`, ou `***` se `< 8` chars).
* **State Machine (`src/state-machine.ts`):**
  ```ts
  export interface TransitionContext {
    hasUi: boolean;
    pausedFromStatus?: DeliverableStatus | null;
    verifyAttempts?: number;
    maxVerifyAttempts?: number;
  }
  export function canTransition(from: DeliverableStatus, to: DeliverableStatus, ctx: TransitionContext): boolean;
  export function assertValidTransition(from: DeliverableStatus, to: DeliverableStatus, ctx: TransitionContext): void;
  export function getAllowedNextStatuses(from: DeliverableStatus, ctx: TransitionContext): DeliverableStatus[];
  ```
  * Arestas: `discovery → spec_review`; `spec_review → visual_studio` (se `hasUi`) ou `contract_tests` (se `!hasUi`); `visual_studio → contract_tests`; `contract_tests → building`; `building → verifying`; `verifying → decision_pending | building (se verifyAttempts < maxVerifyAttempts) | failed`; `decision_pending → approved | building | failed`; `approved → merged`; qualquer estágio ativo (`discovery..decision_pending`, `approved`) → `paused`; `paused → pausedFromStatus` (ou `failed`).

### 4.2 Persistência (`packages/db/src/schema/workspace.ts`) & Matriz RBAC
* **Tabelas:**
  * `clients`: `id`, `organizationId` (FK cascade), `name`, `slug`, `isDefaultInternal`, `notes`, `createdAt`, `updatedAt`. `UNIQUE(organizationId, slug)`. Cliente `"Internos"` (`isDefaultInternal: true`) não pode ser excluído nem ter `slug` desmarcado.
  * `projects`: `id`, `clientId` (FK cascade), `name`, `slug`, `description`, `defaultDevelopmentStrategy`, `maturityScore` (nullable), `designMdPath` (nullable), `status`, `createdAt`, `updatedAt`. `UNIQUE(clientId, slug)`.
  * `project_repositories`: `id`, `projectId` (FK cascade), `name`, `localPath`, `remoteUrl` (nullable), `defaultBranch`, `stackMetadataJson` (`jsonb`), `createdAt`, `updatedAt`.
  * `deliverables`: todas as colunas da Spec §4.2 (`projectId`, `repositoryId` nullable `onDelete: "set null"`, `title`, `description`, `status`, `pausedFromStatus` nullable, `hasUi`, `developmentStrategy`, `tacticalPattern`, `riskLevel`, `worktreePath`, `branchName`, `mastraRunId`, `lockedBy`, `lockedAt`, `verifyAttempts`, `maxVerifyAttempts`, `specMarkdown`, `blueprintJson`, `evidencePackJson`, `createdAt`, `updatedAt`).
  * `provider_profiles`: `id`, `organizationId` (FK cascade), `name`, `providerType`, `baseUrl` (nullable), `encryptedApiKey` (nullable para `ollama`), `keyPreview` (nullable, persistido na escrita para que `GET` nunca descriptografe), `roleBindingsJson` (`jsonb` default `{}`), `isDefault` (`boolean` default `false`), `createdAt`, `updatedAt`.
* **Seed & Bootstrap:**
  * `ensureDefaultOrgAndInternalClient(db, userId?)` roda em transação idempotente (`onConflictDoNothing()` + `UPDATE users ... WHERE organization_id IS NULL`).
  * `bootstrapOmniRouteIfConfigured(db, organizationId)` em `apps/web/src/lib/vault.ts` cria perfil padrão OmniRoute cifrado com AES-256-GCM se `OMNIROUTE_BASE_URL` e `OMNIROUTE_API_KEY` estiverem configurados e nenhum perfil existir ainda na organização.
* **Matriz RBAC & Anti-IDOR (`apps/web/src/lib/rbac.ts`):**
  * `requireOrgRole(request, allowedRoles)` consulta `users` no DB via `session.user.id` (fonte autoritativa).
  * `GET` (todos os recursos): `["owner", "admin", "developer", "auditor"]`.
  * Mutações em `clients`, `projects`, `repositories`, `deliverables`: `["owner", "admin", "developer"]`.
  * Mutações em `providers`: `["owner", "admin"]`.
  * Toda leitura/mutação por `:id` verifica pertencimento à `actor.organizationId` via `INNER JOIN` até `clients.organizationId` (retornando `404` se pertencer a outra org). `POST /api/projects/[id]/deliverables` valida ainda que `repositoryId` pertence ao `project.id`.

### 4.3 UI, MSW e Anti-FOUC (`apps/web`)
* Tema `:root` = **Dark Industrial** (OKLCH `.uzina/DESIGN.md`); `[data-theme="light"]` = **Crisp Light** com script inline anti-FOUC lendo `localStorage("uzina-theme")` e `suppressHydrationWarning` em `<html>`. Fontes `Geist` e `Geist_Mono` via `next/font/google` mapeadas no `@theme inline` do Tailwind CSS v4.
* `/` redireciona server-side para `/app` se houver sessão válida ou `/login` caso contrário (mantendo acesso direto ao diagnóstico `/api/health`).
* `/login`: abas *Entrar* e *Criar conta* (Better Auth) + validação Zod.
* `/app/layout.tsx`: valida sessão Better Auth no servidor (fazendo bypass somente quando `NEXT_PUBLIC_API_MOCKING === "enabled"` em modo preview MSW) e chama `ensureDefaultOrgAndInternalClient`.
* `MswProvider` (`NEXT_PUBLIC_API_MOCKING === "enabled"`) aguarda `worker.start({ onUnhandledRequest: "bypass" })` antes de montar queries.
* `workspace-board.tsx` e `providers-manager.tsx` implementam explicitamente os **5 estados** (*Empty com CTA*, *Sparse*, *Dense*, *Loading Skeleton CLS=0*, *Error com retry*) e `tabular-nums`.

---

## 5. Plano de Testes (*Spec → Teste* antes do Build)

1. **`@uzina/contracts` (`tests/slice1-contracts.test.ts`):** `test.each` para clientes, projetos, entregas, provedores e rejeição estrita de `apiKey`/`encryptedApiKey` em `ProviderProfilePublicSchema`.
2. **`@uzina/core` (`tests/vault.test.ts`, `tests/state-machine.test.ts`):** round-trip AES-256-GCM, unicidade de IV, tamper em IV/tag/ciphertext, violação de AAD cross-tenant, `maskApiKey`, `resolveMasterKey` strict/local, e matriz completa `canTransition`/`assertValidTransition`.
3. **`@uzina/db` (`tests/workspace-schema.test.ts`):** PGlite `:memory:` testando seed idempotente `"Internos"`, cascata completa e isolamento entre 2 organizações.
4. **`apps/web` (`tests/contract-drift.test.ts`, `tests/slice1-api.test.ts`):** Contract Drift Check (MSW vs rotas reais contra `@uzina/contracts`), isolamento anti-IDOR entre Org A e Org B (`404`), bloqueio RBAC (`403` para `auditor` e `developer` em `/api/providers`), `422` em transição inválida de `deliverable` e ausência de segredos em `/api/providers`.

---

## 6. Critérios de Pronto (DoD)
* [x] `pnpm verify` (`check-no-ee` + `typecheck` + `lint` + `build` + `test`) 100% verde (`exit 0`).
* [x] Cliente `"Internos"` criado automaticamente; CRUD completo de `Clients → Projects (+ Repos) → Deliverables` e `Provider Profiles` funcionando com PGlite real.
* [x] UI navegável seguindo `.uzina/DESIGN.md` (OKLCH Dark/Light, `tabular-nums`, 5 estados, `Cmd+K`, zero "AI slop") e validada no `browser` em `1280×800`, `768×1024` e `390×844`.
* [x] Auditorias `test-critic`, `appsec-auditor` e `factory-verifier` concluídas sem pendências bloqueantes.

---

## 7. Revisão EGM Pré-Código (Plan Gate)

Auditado por **`egm-implementation-readiness`** (**5 BLOCKERs** e **3 WARNINGs**). Todos os apontamentos foram incorporados antes da codificação:
* `BLOCKER #1`: `keyPreview` persistido em `provider_profiles` (`GET` nunca descriptografa), nullability de `encryptedApiKey`/`baseUrl` e `providerType` imutável em `PATCH`.
* `BLOCKER #2`: assinaturas completas de `state-machine.ts`, arestas de retry/falha e coluna `pausedFromStatus` em `deliverables`.
* `BLOCKER #3`: `@uzina/core@workspace:*` + `zod@4.6.7` listados em `apps/web`, colunas completas da Spec §4.2 em `workspace.ts`, `UNIQUE(organization_id, slug)` / `UNIQUE(client_id, slug)` e proteção do cliente `"Internos"`.
* `BLOCKER #4`: `requireOrgRole` consultando `users` no DB + seed transacional idempotente (isolando novos signups em organização própria, default `users.role = "auditor"` via migração `0002`) + matriz RBAC + `INNER JOIN` anti-IDOR.
* `BLOCKER #5`: tabela REST completa + `ApiErrorSchema` + `HttpUrlSchema` (`http:`/`https:`) + `public/mockServiceWorker.js` + `MswProvider` (`onUnhandledFrame: "bypass"` + trava `NODE_ENV !== "production"`).
* `WARNING #6-#8`: `@radix-ui/react-dialog@1.3.1`, `Geist`/`Geist_Mono`, script anti-FOUC Dark/Light, `MasterKeyInputSchema`, `bootstrapOmniRouteIfConfigured`, fluxo `/`, `/login` (Entrar + Criar conta) e guarda server-side em `/app/layout.tsx`.

---

## 8. Evidências Reais Pós-Código (Verify Gate)

* **Saída `node scripts/check-no-ee.mjs`:** `OK [check-no-ee]: Nenhuma dependência ou importação comercial Mastra ee/ encontrada.` (`exit 0`).
* **Saída `pnpm verify` (e `pnpm turbo run build --force` + `typecheck lint test --force`):** **exit code `0`** (**107 testes aprovados**, `0` erros e `0` warnings de lint):
  * `@uzina/contracts`: **38/38** testes (`contracts.test.ts` + `slice1-contracts.test.ts`), `tsc`, `eslint`.
  * `@uzina/core`: **37/37** testes (`vault.test.ts` + `state-machine.test.ts`), `tsc`, `eslint`.
  * `@uzina/db`: **17/17** testes (`dual-mode`, `pglite-integration`, `workspace-schema`) + **1 skipped** esperado (`postgres-live.test.ts` sem `TEST_DATABASE_URL`), migrações `0001_mysterious_major_mapleleaf.sql` e `0002_military_blacklash.sql`.
  * `@uzina/web`: **15/15** testes (`health-route`, `auth-route`, `contract-drift`, `slice1-api`), `next build` (17 rotas compiladas), `tsc --noEmit`, `eslint`.
* **Validação Visual (`browser` `flash` em `http://localhost:3000`):**
  * Jornada completa `/login` (Sign Up) → `/app` (cliente `"Internos"` + projeto + entrega + Kanban/Lista + `Cmd+K`) → `/app/providers` (OmniRoute com chave exibida apenas como `sk-...6655`) → alternância Dark/Light → `1280×800`, `768×1024`, `390×844` sem overflow global e sem erros de console/HTTP; polimentos de drawer mobile, `<select>` e rótulos da Lista aplicados e revalidados no `pnpm verify`.
* **Vereditos dos Auditores Independentes:**
  * `appsec-auditor` (`flash`): apontamentos `CRITICAL/HIGH/MEDIUM/LOW` corrigidos (default `"auditor"` + isolamento de signup aberto, trava `NODE_ENV !== "production"` no MSW, `HttpUrlSchema`, `GET /api/providers` read-only e `UPDATE` composto).
  * `test-critic` (`flash`): bordas `401`, `400`, `409`, `UNIQUE` e envelopes malformados adicionadas e passando.
  * `factory-verifier` (`inherit`): **`PASS`** após todas as correções (`pnpm verify` exit `0`, **107 testes** aprovados, `0` ocorrências de `any` / `as unknown as` / `@mastra/*-ee`).
