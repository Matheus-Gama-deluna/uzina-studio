# Diário de Progresso & Checkpoints — Uzina Studio

Registro cronológico curto de cada fase ou slice concluído, decisões tomadas e próximo passo recomendado.

---

## 2026-11-21 — Fase 0: Bootstrap, Governança e Dossiê do Slice 0

* **Identidade travada:** Produto **Uzina Studio**, namespace `@uzina/*`, CLI `uzina`, pasta `.uzina/`, variável `UZINA_DATA_DIR` (ADR-001).
* **Ambiente:** `pnpm@12.21.0` ativado; `git init -b main` executado; `.gitignore` robusto criado; `.npmrc` (`save-exact=true`) e `.env.example` configurados.
* **Kit extraído e corrigido:**
  * Specs preservadas em `docs/especificacao-produto-arquitetura-v2.10.md` e `docs/especificacao-tecnica-fase-1-v1.1.md`.
  * 8 skills nativas extraídas em `packages/skills/*/SKILL.md` e alinhadas a `.uzina/`.
  * Corrigido bug de regex em `scripts/check-no-ee.mjs` (o espaço literal após `-ee` impediria bloqueio de `"@mastra/foo-ee"`).
  * `AGENTS.md` mesclado preservando invariantes prévios + regras do kit + protocolo EGM seletivo; regras e workflow `/execute-slice` criados em `.agents/`.
* **Controle de fases implantado:** `ROADMAP_STATUS.md`, `PROGRESS_LOG.md`, `.uzina/slices-checklist.md`, `docs/adr/000-002`, `docs/slices/00-template-slice.md`, `docs/SETUP_AMBIENTE.md`.
* **Dossiê do Slice 0:** `docs/slices/slice-00-walking-skeleton.md` elaborado, verificado contra versões reais no npm/Context7 e auditado pelo Plan Gate EGM (`egm-implementation-readiness` + `egm-design`), resolvendo 6 BLOCKERs, 5 WARNINGs e 10 achados arquiteturais antes da primeira linha de código.
* **Próximo passo:** Aprovação do usuário para abrir a branch `feat/slice-00-walking-skeleton` e implementar o **Slice 0**.

---

## 2026-11-21 — Slice 0: Walking Skeleton (`feat/slice-00-walking-skeleton`)

* **Entregue:**
  * Monorepo `pnpm@12.21.0` + Turborepo v2 (`turbo@2.11.13`), `tsconfig.base.json` strict (`typescript@5.9.3`), `eslint.config.mjs` (bloqueando `any` e `as unknown as`), `docker-compose.dev.yml` (`pgvector/pgvector:pg16`).
  * `@uzina/contracts`: 11 enums base + `HealthPublicSchema` + `HealthDetailsSchema` (`21/21` testes).
  * `@uzina/db`: schema Drizzle `pg-core` (5 tabelas UUID com índices), migração `0000_living_thunderbird.sql` automática no cold start, singleton `Symbol.for("@uzina/db/singleton")`, fail-fast em `DATABASE_URL` inválida (`15/15` testes PGlite/unit + `1 skipped` `postgres-live` sem `TEST_DATABASE_URL`).
  * `apps/web`: Next.js `16.4.6` App Router + Better Auth `1.7.27` lazy + `GET /api/health` (`200`/`503`) + `GET /api/health/details` autenticado (`401`/`200`/`503`) + painel inicial (`12/12` testes integração real).
* **Validação & Verificadores:**
  * `pnpm verify`: **12/12 tasks verdes** (exit `0`).
  * `browser` (`flash`): `http://localhost:3000` e `/api/health` validados visualmente em desktop (`1280x800`) e mobile (`390x844`), zero erros de console/rede.
  * `test-critic`, `appsec-auditor`, `egm-codebase-details` e `factory-verifier`: **PASS** final após incorporar todas as bordas e ajustes `LOW`.
* **Próximo passo:** Aprovar/mergear PR do Slice 0 e iniciar o Dossiê + Plan Gate EGM do **Slice 1 (Hierarquia, Cofre AES-256-GCM & UI com MSW)**.

---

## 2026-11-21 — Slice 1: Hierarquia, Cofre AES-256-GCM & UI com MSW (`feat/slice-01-hierarchy-vault-ui`)

* **Entregue:**
  * `@uzina/contracts`: schemas Zod completos (`clients`, `projects`, `deliverables`, `providers`, `errors`, `HttpUrlSchema`, `ProviderProfilePublicSchema.strict()`) (`38/38` testes).
  * `@uzina/core`: Cofre AES-256-GCM (IV 12B, AuthTag 16B, AAD `${orgId}:${providerType}`, `MasterKeyInputSchema`, `maskApiKey`) e `StateMachine` (`@uzina/core/state-machine`) (`37/37` testes).
  * `@uzina/db`: 5 tabelas (`clients`, `projects`, `project_repositories`, `deliverables`, `provider_profiles`), migrações `0001`/`0002`, seed `"Internos"` + isolamento de signup aberto (`17/17` testes + `1 skipped` `postgres-live`).
  * `apps/web`: 9 rotas REST com RBAC multi-tenant + anti-IDOR, MSW v3 + Contract Drift Check (`15/15` testes), e Cockpit em Tailwind CSS v4 OKLCH Dark/Light (`/login`, `/app` Kanban ↔ Lista + `Cmd+K`, `/app/providers`).
* **Validação & Verificadores:**
  * `pnpm verify`: **107 testes aprovados**, `next build`, `tsc --noEmit` e `eslint` com `0` erros e `0` warnings (`exit 0`).
  * `browser` (`flash`): fluxo completo E2E em `http://localhost:3000` (Dark/Light, `1280×800`, `768×1024`, `390×844`) validado sem erros de console/HTTP e sem exposição de chave privada.
  * `appsec-auditor`, `test-critic` e `factory-verifier`: **PASS** após aplicação de todas as correções.
* **Próximo passo:** Iniciar o Dossiê + Plan Gate EGM (`egm-implementation-readiness` + `egm-design`) e implementação do **Slice 2 (`@uzina/opencode-bridge`, Worktrees & `StuckDetector`)**.

---

## 2026-11-21 — Slice 2: OpenCode Bridge, Git Worktrees, 8 Skills & `StuckDetector` (`feat/slice-02-opencode-bridge-stuck-detector`)

* **Entregue:**
  * `@uzina/contracts`: `src/execution.ts` (contratos Zod v4 para worktrees, exec, skills, configuração server-side de provedor, observações de turno, 5 padrões `StuckDetector`, `OpenCodeRunSessionOptionsSchema` e `OpenCodeSessionResultSchema`) + proteção anti-IMDS em `HttpUrlSchema` (`62/62` testes).
  * `@uzina/core`: `src/redact.ts` (`redactSecrets`, `redactSecretsInValue`, `redactError`, browser-safe), `src/path-guard.ts` (contenção anti-traversal/dangling symlinks/UNC/ADS/nomes reservados Windows, `sanitizeWorktreeSlug`, `assertSafeGitRef`), `src/stuck-detector.ts` (5 padrões OpenHands puros, zero `node:*`, export `./stuck-detector`) e `src/skills-loader.ts` (carregamento validado das 8 skills reais de `packages/skills/*/SKILL.md`, `97/97` testes).
  * `@uzina/opencode-bridge`: novo pacote com `@opencode-ai/sdk@1.19.6` (MIT), `LocalGitWorktreeWorkspace` (worktrees Git isoladas, `shell: false`, allowlist de `env`, parser de flags globais `git`, kill completo da árvore de processos, `getDiff` com *untracked* e limpeza idempotente), `SdkOpenCodeTransport` (processo embedded isolado sem mutar `process.env`/`XDG_*`, SSE `/event` em tempo real *fail-closed*, `PLAN_MODE_PERMISSION_RULESET`), `InMemoryOpenCodeTransport` (`./testing`) e `OpenCodeRunner` (Prompt Cache fixo por papel, isolamento `plan` em 3 camadas, cofre AES-256-GCM efêmero, `maxSteps`, `AbortSignal`/`timeoutMs` e `StructuredOutput`, `44/44` testes).
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs`: exit `0`.
  * `pnpm verify` sem cache (`build --force` + `typecheck lint test --force`): **235 testes aprovados** (`1 skipped` `postgres-live` sem `TEST_DATABASE_URL`), **0 erros/warnings** ESLint/Turbopack.
  * Plan Gate EGM (`egm-implementation-readiness` + `egm-design`) aprovado pré-código; Verify Gate (`appsec-auditor`, `test-critic`, `egm-codebase-details`, `factory-verifier`) **PASS** unânime pós-código.
* **Próximo passo:** Elaborar Dossiê + Plan Gate EGM (`egm-implementation-readiness` + `egm-design`) e implementar o **Slice 3 (`@uzina/mastra-runtime` & Estúdio Visual Lite)**.

---

## 2026-11-21 — Slice 3: Workflow Mastra (Apache 2.0), Descoberta 5 Pilares & Estúdio Visual Lite (`feat/slice-03-mastra-workflow-visual-studio`)

* **Entregue:**
  * `@uzina/contracts`: schemas Zod v4 em `src/workflow.ts` (`DesignAsset*`, `Discovery*`, `BrownfieldMap`, `StrategyRouter*`, `DeliverableWorkflowState`) e retrocompatibilidade em `DeliverableSchema` (`86/86` testes).
  * `@uzina/core`: atualização controlada de `state-machine.ts` (`-> failed`), subpaths browser-safe (`./strategy-router`, `./discovery`, `./design-md` sem imports `node:*`) e `brownfield.ts` somente leitura (symlinks ignorados, limite 256 KiB, Scorecard `0–100` com `securityPosture` 5×4 pts, `121/121` testes).
  * `@uzina/opencode-bridge`: método `attach(existingHandle)` em `ExecutionWorkspace`/`LocalGitWorktreeWorkspace` para compartilhamento da mesma worktree entre `stage_contract_and_tests` e `stage_build` (`45/45` testes).
  * `@uzina/db`: tabela `design_assets` (`intention_tags text[]`), migration `0003_tiresome_silver_samurai.sql` e locks SQL atômicos com TTL padrão `5` min (`packages/db/src/locks.ts`, `21/21` passed + `1 skipped` `postgres-live`).
  * `@uzina/mastra-runtime`: novo pacote Apache 2.0 estrito (`@mastra/core@1.85.0`, `@mastra/libsql@1.31.1`, `@mastra/pg@1.37.0`), storage dual-mode (`LibSQLStore` com `pathToFileURL` ↔ `PostgresStore`), workflow durável de 5 etapas (`stage_discovery` → `stage_blueprint` → `stage_visual_studio` → `stage_contract_and_tests` → `stage_build`), heartbeat de lock, `stuck_intervention` em loop e pré-validação de portões (`10/10` testes incluindo sobrevivência real a restart).
  * `apps/web`: 8 rotas REST (RBAC, anti-IDOR, upload magic bytes PNG/JPEG/WEBP com pré-checagem `Content-Length` `413` e `GET /api/assets/[id]` com `nosniff` + `CSP sandbox`), handlers MSW completos + Contract Drift Check e Estúdio Visual (`/app/projects/[id]/studio`, `19/19` testes).
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs`: exit `0`.
  * `pnpm turbo run build typecheck lint test --force` (uncached): **24/24 tasks verdes**, **302 testes passed** (`1 skipped` `postgres-live`), `0` erros/warnings ESLint/Turbopack.
  * `browser` (`flash`): **PASS** em `/app` e `/app/projects/[id]/studio` (`1280×800`, `768×1024`, `390×844`, Dark/Light).
  * `appsec-auditor` (`PASS`), `test-critic` (`NEEDS_FIX` -> corrigido), `egm-codebase-details` (`NEEDS_FIX` -> corrigido) e `factory-verifier`: **PASS**.
* **Próximo passo:** Iniciar o Dossiê + Plan Gate EGM (`egm-implementation-readiness` + `egm-design`) do **Slice 4 (`.uzina/verify`, `@uzina/security-engine` v1 & Caixa de Decisões HITL — Marco Utilizável #1)**.

---

## 2026-11-22 — Slice 4: `.uzina/verify`, `@uzina/security-engine` v1 & Caixa de Decisões HITL (`feat/slice-04-verify-security-engine-decisions`) ★ Marco Utilizável #1

* **Entregue:**
  * `@uzina/contracts`: `"pr_evidence_approve"` em `WorkflowGateTypeSchema`, `VerifierVerdictOutputSchema`, `evidencePackJson` em `DeliverableSchema`, schemas `.strict()` em `src/security.ts` e `src/decisions.ts` (`108/108` testes).
  * `@uzina/core` + `scripts/audit-tests.mjs`: `TestAuditor` browser-safe (`@uzina/core/test-auditor`, 5 anti-patterns + supressão anotada), `auditTestDirectory`, `approved -> failed` na `StateMachine`, `redactSensitiveText` / `redactSensitiveValue` e `estimateTokenCostUsd` (`137/137` testes; `audit:tests` integrado ao `verify` raiz com `0` violações em `37` arquivos / `139` testes).
  * `@uzina/db`: tabelas `decisions`, `security_scans`, `security_findings` e `execution_events` (`packages/db/src/schema/operations.ts`) + migração `0004_open_stephen_strange.sql` (`24` passed + `1` skipped `postgres-live`).
  * `@uzina/security-engine`: pacote dual-mode com 3 scanners nativos TS (`native_secrets`, `native_ddl`, `native_slopsquatting`), 4 adaptadores (`gitleaks`, `opengrep`/fallback `semgrep`, `trivy`, `osv_scanner`) com `shell: false`, anti-flag + `--`, `skipped_missing_binary` explícito em SARIF 2.1.0, `fingerprint` SHA-256 pré-redação + redação universal, portas `FindingSuppressionLookup` & `SecurityTriageEvaluator`, trava DAST com allowlist de servidor + DNS lookup anti-IMDS/privados, e CLI stateless `uzina-sec` (`19/19` testes).
  * `@uzina/mastra-runtime`: `deliveryCycleWorkflow` (`.dountil()` envolvendo `stageBuild -> stageVerify -> stageDecision`) + `stageFinalize`, heartbeat global no `withDeliverableLock`, `ExecutionEventBus` in-memory, `resolveDecision` com guarda atômica `409 DECISION_ALREADY_RESOLVED`, isolamento CoT Builder vs Verifier em modo `plan` (`13/13` testes incluindo restarts reais e todos os ciclos `verify`, `changes_requested` e `rejected`).
  * `apps/web`: plugin `bearer()` no Better Auth para CLI stateless, 7 rotas REST/SSE (`/api/decisions`, `/api/decisions/[id]/resolve`, `/api/security/scans`, `/api/security/scans/ingest`, `/api/security/scans/[id]`, `/api/security/findings/[id]`, `/api/deliverables/[id]/events`), trava RBAC `VAULT_WRITE_ROLES` em `pr_evidence_approve` e `suppressedInMemory`, MSW + Contract Drift Check, telas `/app/decisions` e `/app/security` + navegação `CockpitShell` e `CommandPalette` (`22/22` testes).
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs`: exit `0`.
  * Verify Gate sem cache: `pnpm turbo run build --force` (**7/7**, 0 warnings Turbopack) + `node scripts/audit-tests.mjs` (**0 violações**) + `pnpm turbo run typecheck lint test --force` (**27/27 tasks**, **368 passed | 1 skipped** `postgres-live.test.ts`).
  * CLI `node packages/security-engine/dist/cli.js doctor` e `scan packages/core --format summary`: exit `0`.
  * `browser` (`flash`): **PASS** em `/app/decisions` e `/app/security` (Desktop `1440×900` Dark/Light e Mobile `390×844`, zero console errors, zero HTTP `>=500`, zero overflow horizontal).
  * *(Observação de cota: subagentes finais `test-critic`, `appsec-auditor` e `factory-verifier` não reexecutados no fechamento por limite de cota solicitado pelo usuário.)*
* **Próximo passo:** Planejar e executar o **Slice 5 (Co-piloto Executivo `.network()` & Memória em 3 Escopos)**.

---

## 2026-11-22 — Slice 5: Co-piloto Executivo & Memória em 3 Escopos (`feat/slice-05-copilot-memories`)

* **Entregue:**
  * `@uzina/contracts`: schemas Zod `.strict()` em `src/memories.ts` (`MemoryCategorySchema`, `CreateMemorySchema`, `UpdateMemorySchema`) e `src/copilot.ts` (`CopilotChatRequestSchema`, `CopilotStreamEventSchema`, `CopilotCapabilitiesSchema`) (`115/115` testes).
  * `@uzina/db`: tabela #8 `memories` (`packages/db/src/schema/memories.ts`) com `scopeType` (`org | client | project`), `scopeId`, `category`, FK opcional `sourceDeliverableId` (`set null`), índice composto `(scopeType, scopeId, category)` e migração `0005_talented_turbo.sql` (`25 passed | 1 skipped`).
  * `@uzina/mastra-runtime`: serviço `src/memories.ts` (`assertValidMemoryScope`, `resolveHierarchicalMemories` sem vazamento entre clientes, `formatMemoriesForPrompt` com redação), agente `executiveCopilot` (`src/agents/executive-copilot.ts` com apenas `read_workspace_overview`, `draft_deliverable` e `trigger_security_scan` — bloqueio comprovado de escrita em disco/shell/`merged`) e injeção/extração automática no `deliverableLifecycle` (`15/15` testes).
  * `apps/web`: APIs `/api/memories`, `/api/memories/[id]`, `/api/copilot/chat` (SSE), MSW + `contract-drift.test.ts`, página `/app/memories`, drawer global `CopilotDrawer` no `CockpitShell` e atalho no `CommandPalette` (`24/24` testes).
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs`: exit `0`.
  * Verify Gate sem cache: `pnpm turbo run build --force` (**7/7**, 0 warnings Turbopack) + `node scripts/audit-tests.mjs` (**41 arquivos, 147 testes, 0 violações**) + `pnpm turbo run typecheck lint test --force` (**27/27 tasks**, **380 passed | 1 skipped** `postgres-live.test.ts`).
  * `browser` (`flash`): **PASS** em `/app/memories` e no `CopilotDrawer` via SSE (Desktop `1440×900` Dark/Light e Mobile `390×844`, 0 erros de console, 0 HTTP `>=500`, 0 overflow horizontal).
* **Próximo passo:** Executar o **Slice 6 (Empacotamento, Migração & Release — CLI `uzina`, `migrate-to-postgres`, Docker, CI/CD & Playwright E2E — Marco Fase 1 Completa)**.

---

## 2026-11-22 — Slice 6: Empacotamento, Migração & Release (`feat/slice-06-packaging-release`) ★ Marco Fase 1 Completa

* **Entregue:**
  * `@uzina/db`: motor idempotente `migrate-to-postgres.ts` (`migrateDatabaseData`, `MIGRATION_TABLE_ORDER` nas 16 tabelas Drizzle em transação única no destino, validação e redação `redactDatabaseUrl`) (`33 passed | 1 skipped` `postgres-live.test.ts`).
  * `@uzina/security-engine` + `apps/cli` (`@uzina/cli`): binário unificado `uzina` / `uzina-studio` (`start`, `dev`, `sec` *stateless*, `db migrate-to-postgres`, `doctor --json`) com validação Zod (`12/12` testes).
  * **Docker & CI/CD:** `output: "standalone"` condicional (`UZINA_STANDALONE=1`) em `apps/web/next.config.ts`, `.dockerignore`, `Dockerfile` multi-stage (`node:22-slim`, usuário não-root `uzina`, 4 scanners AppSec), `docker-compose.yml` (`pgvector/pgvector:pg16` + `uzina`), `.github/workflows/ci.yml` e `.github/workflows/release.yml`, e `README.md` atualizado.
  * **Playwright E2E (`apps/web/e2e/smoke.spec.ts`):** fluxo ponta a ponta em Chromium contra servidor de produção (`GET /api/health` + signup -> projeto -> entrega -> páginas operacionais -> Co-piloto SSE).
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs`: exit `0`.
  * Verify Gate sem cache contra PostgreSQL 16 + `pgvector` live (`TEST_DATABASE_URL`): `pnpm turbo run build --force` (**8/8** pacotes) + `node scripts/audit-tests.mjs` (**43 arquivos, 155 testes, 0 violações**) + `pnpm turbo run typecheck lint test --force` (**30/30 tasks**, **402 passed | 0 skipped** — `postgres-live.test.ts` verde!).
  * `pnpm --filter @uzina/web test:e2e`: **2 passed (11.2s)** (0 console errors, 0 pageerrors, 0 HTTP `>=500`, 0 overflow horizontal).
  * **Docker & PostgreSQL Live:** `docker build` multi-stage validado (UID `1001`, 4 scanners verificados com `sha256sum -c`: `gitleaks 8.24.2`, `trivy 0.76.2`, `osv-scanner 2.0.0`, `opengrep 2.0.0`), stack completa `docker-compose.yml` saudável (`PG=healthy APP=healthy`, E2E HTTP/Auth/Postgres/SSE `DOCKER_FULLSTACK_E2E_OK`) e `uzina db migrate-to-postgres` validado 2x contra `pgvector:pg16` (idempotente, senha mascarada).
  * **Revisões & Hardening:** `appsec-auditor` (corrigidos `staging_url` anti-IDOR, isolamento `requestContext` nas tools do Co-piloto, RBAC de supressão no `/ingest`, hardening Docker/Compose), `test-critic` (lacunas sanadas em todos os pacotes) e `factory-verifier` (**PASS**).
* **Marco Atingido:** **Fase 1 (MVP) 100% Concluída e Validada em Todas as Camadas** (`Slices 0 → 6`). Próximas ações: abertura/merge da Pull Request para `main` via GitHub.


---

## 2026-11-22 — Planejamento da Fase 2 (Slices 7–10) — pré-código

* **Entregue (somente documentação):**
  * `docs/especificacao-tecnica-fase-2-v1.0.md` (escopo, fronteiras, schema, QMD, codebase-intel, Stitch, Docker/FinOps, riscos).
  * `docs/adr/004-codebase-intelligence-qmd-embeddings-stitch.md` (decisão: QMD híbrido + `multilingual-e5-small` + grafo AST + Google Stitch; Figma adiado).
  * Dossiês: `slice-07` (QMD/embeddings), `slice-08` (codebase-intel), `slice-09` (Estúdio Visual + Stitch), `slice-10` (Docker workspace + FinOps).
  * Atualizados: `.uzina/slices-checklist.md`, `docs/status/ROADMAP_STATUS.md`, `.uzina/steering.md`, `AGENTS.md`.
* **Próximo passo:** Plan Gate EGM (`egm-implementation-readiness` + `egm-design`) do Slice 7 e criação da branch `feat/slice-07-qmd-hybrid-memory`.

---

## 2026-11-22 — Slice 7: Motor QMD Híbrido (`BM25 + Vetor 384d + RRF`) & Busca em `/app/memories` (`feat/slice-07-qmd-hybrid-memory`)

* **Entregue:**
  * `@uzina/contracts`: schemas Zod `.strict()` em `src/qmd.ts` (`QmdSearchRequestSchema`, `QmdSearchHitSchema`, `QmdSearchResponseSchema`, `QmdReindexRequestSchema`, `QmdReindexResponseSchema`, `QmdStatusSchema`) (`126/126` testes).
  * `@uzina/core`: `src/qmd.ts` (`chunkMarkdownByHeadings`, `tokenizeForQmd`, `computeBm25Scores`, `cosineSimilarity`, `reciprocalRankFusion`, `formatQmdSnippet`, `buildDirectoryContextTree`, `createDeterministicEmbeddingProvider` 384d) exportado via subpath `@uzina/core/qmd` (`141/141` testes).
  * `@uzina/db`: tabela #17 `memory_chunks` (`packages/db/src/schema/memory-chunks.ts`), migração `0006_natural_obadiah_stane.sql` e inclusão em `MIGRATION_TABLE_ORDER`/`TABLE_REGISTRY` (`36 passed | 0 skipped` em PostgreSQL + `pgvector` live).
  * `@uzina/mastra-runtime`: `src/qmd.ts` (`indexMemoryChunks`, `reindexWorkspaceQmd`, `searchQmdScoped` com backfill incremental automático, isolamento `org/client/project` e `redactSensitiveText`) integrado a `createMemoryScoped`/`updateMemoryScoped` (`16/16` testes).
  * `apps/web` & `apps/cli`: `POST /api/memories/search` (`READ_ROLES`), `POST /api/qmd/reindex` (`VAULT_WRITE_ROLES`), MSW + Contract Drift Check, UI de busca híbrida QMD em `/app/memories` (`25/25` testes) e subcomando `uzina memory search <query>` (`13/13` testes).
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs` (exit `0`), `pnpm turbo run build --force` (`8/8` pacotes), `node scripts/audit-tests.mjs` (`48 arquivos, 165 testes, 0 violações`).
  * `pnpm turbo run typecheck lint test --force` com `TEST_DATABASE_URL` no PostgreSQL 16 + `pgvector`: **`30/30` tasks**, **`421 passed | 0 skipped`**.
  * `pnpm --filter @uzina/web test:e2e`: **`2 passed (11.7s)`**.
  * `browser` (`flash`): **PASS** em `/app/memories` (criação de `adr-qmd-cache`, reindexação `352` chunks, busca `"Reciprocal Rank Fusion"` com `5` hits e scores `RRF / BM25 / Vec` `tabular-nums`, `0` erros de console/HTTP `>=500`/overflow em Desktop Dark/Light e Mobile).
* **Próximo passo:** Abertura/merge de PR do Slice 7 para `main` e início do **Slice 8 (`@uzina/codebase-intel`)**.

---

## 2026-11-22 — Slice 8: Codebase Intelligence (`@uzina/codebase-intel`), Grafo AST, Esqueleto & Proveniência (`feat/slice-08-codebase-intel`)

* **Entregue:**
  * `@uzina/contracts`: schemas Zod `.strict()` em `src/codebase.ts` (`CodebaseSymbolKindSchema`, `CodebaseRelationSchema`, `SymbolGraphQuerySchema`, `SymbolSliceRequestSchema`, `ProvenanceQuerySchema`, `ChangeImpactRequestSchema`, `SkeletonResponseSchema`, `CodebaseTreeResponseSchema`, `CodebaseReindexResponseSchema`) (`138/138` testes).
  * `@uzina/codebase-intel`: novo pacote isolado (importa apenas `@uzina/contracts` e `@uzina/core`, zero `@uzina/db`) com `ts-indexer.ts` (TypeScript Compiler API), `skeleton.ts` (esqueleto Prompt Cache com orçamento `UZINA_SKELETON_MAX_TOKENS`), `graph.ts` (`querySymbolGraphInMemory`, `computeChangeImpactInMemory`, `readSymbolSliceFromWorkspace` com `assertPathInsideWorkspace`, bloqueio `.env*`/`.master-key` e `redactSensitiveText`) e `adapters.ts` (`probeCodebaseAdapters` com degradação `skipped_missing_binary`) (`8/8` testes).
  * `@uzina/db`: 4 tabelas (`codebase_files`, `codebase_symbols`, `codebase_edges`, `decision_provenance`) em `src/schema/codebase.ts`, migração `0007_peaceful_grandmaster.sql` e suporte em `MIGRATION_TABLE_ORDER` (`37 passed | 0 skipped` em PostgreSQL 16 + `pgvector` live).
  * `@uzina/mastra-runtime`: `src/codebase.ts` (`syncRepositoryCodebase` incremental por SHA-256, remoção de deletados, consulta ao grafo, slice, impacto e proveniência) + hook `recordDeliverableProvenance` em `stage_finalize` (`17/17` testes).
  * `apps/web` & `apps/cli`: 4 rotas REST (`/api/projects/[id]/codebase*`), MSW + `contract-drift.test.ts`, tela **Mapa do Código** (`/app/projects/[id]/code` com link no Estúdio, `26/26` testes) e comandos `uzina code skeleton` / `uzina index code` (`13/13` testes).
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs` (exit `0`), `pnpm turbo run build --force` (`9/9` pacotes), `node scripts/audit-tests.mjs` (`53 arquivos, 173 testes, 0 violações`).
  * `pnpm turbo run typecheck lint test --force` com `TEST_DATABASE_URL` em PostgreSQL 16 + `pgvector` live: **`34/34` tasks**, **`444 passed | 0 skipped`**.
  * Revalidação final pós-ajuste Mobile de `project-codebase-map.tsx`: `typecheck`, `lint`, `next build`, `vitest run` (`26 passed`) e `test:e2e` (`2 passed (11.7s)`).
  * `browser` (`flash`): **PASS** em `/app/projects/[id]/code` (Desktop Dark/Light `1440×900` e Mobile `390×844` após correção de overflow horizontal, `0` erros de console, `0` HTTP `>= 500`, `0` overflow).
* **Próximo passo:** Abertura/merge de PR e início do **Slice 9 — Estúdio Visual 3 Níveis & Google Stitch**.

---

## 2026-11-22 — Slice 9: Estúdio Visual 3 Níveis & Google Stitch (`feat/slice-09-visual-studio-stitch`)

* **Entregue:**
  * `@uzina/contracts`: `src/prototypes.ts` + `"prototype_approve"` em `DecisionTypeSchema`/`WorkflowGateTypeSchema` (`146/146` testes).
  * `@uzina/core`: `src/prototypes.ts` (exportado em `@uzina/core/prototypes`) com `sanitizePrototypeHtml`, `extractW3CDesignTokens`, `generateMermaidWireframeFromSpec`, `renderTokensToDesignMdSection` (`149/149` testes).
  * `@uzina/db`: tabela #22 `design_prototypes` (`src/schema/prototypes.ts`), migração `0008_old_marvex.sql` e inclusão em `MIGRATION_TABLE_ORDER` (`38 passed | 0 skipped` em PostgreSQL 16 + `pgvector` live).
  * `@uzina/mastra-runtime`: `src/prototypes.ts` (armazenamento em `${UZINA_DATA_DIR}/uploads/prototypes/`, cliente Stitch MCP stdio via `execFile` `shell: false`, aprovação + handoff `.uzina/prototypes/<id>/` + sync `DESIGN.md`) (`19/19` testes).
  * `@uzina/web`: 4 rotas REST (`/api/projects/[id]/prototypes*` + `/api/prototypes/[id]/preview` com `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:;`), MSW + `contract-drift.test.ts` e `StitchPrototypesPanel` no Estúdio Visual (`27/27` testes).
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs` (exit `0`), `pnpm turbo run build --force` (`9/9` pacotes), `node scripts/audit-tests.mjs` (`58 arquivos, 183 testes, 0 violações`).
  * `pnpm turbo run typecheck lint test --force` com `TEST_DATABASE_URL` no PostgreSQL 16 + `pgvector` live: **`34/34` tasks**, **`464 passed | 0 skipped`**.
  * `pnpm --filter @uzina/web test:e2e`: **`2 passed (11.9s)`**.
  * `browser` (`flash`): **PASS** em `/app/projects/[id]/studio` (importação HTML com `<script>` neutralizado, tokens W3C, `<iframe sandbox="">`, aprovação/handoff, degradação graciosa de Stitch MCP, `0` console errors, `0` HTTP `>= 500`, `0` overflow em Desktop Dark/Light e Mobile).
* **Próximo passo:** Abertura/merge de PR e início do **Slice 10 — `DockerExecutionWorkspace` & FinOps de Tokens**.

---

## 2026-11-22 — Slice 10: `DockerExecutionWorkspace` & FinOps de Tokens (`feat/slice-10-docker-workspace-finops`) ★ Marco Fase 2 Completa

* **Entregue:**
  * `@uzina/contracts`: `src/finops.ts` (`WorkspaceKindSchema`, `TokenSavingsTechniqueSchema`, `TokenSavingsEventSchema`, `RecordTokenSavingsSchema`, `FinopsSummaryRequestSchema`, `FinopsSummarySchema`) (`152/152` testes).
  * `@uzina/opencode-bridge`: `src/docker-workspace.ts` (`buildDockerRunArgs`, `assertSafeDockerOptions`, `DockerExecutionWorkspace` com `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only`, `--tmpfs`, `--user 1001:1001`, `--network none`, limites CPU/memória/PIDs, proibição de `root`/`docker.sock` e limpeza `docker rm -f`) (`51/51` testes).
  * `@uzina/db`: tabela #23 `token_savings_events` (`src/schema/finops.ts`), migração `0009_pale_hellion.sql` e suporte em `MIGRATION_TABLE_ORDER` (`39 passed | 0 skipped` em PostgreSQL 16 + `pgvector` live).
  * `@uzina/mastra-runtime`: `src/finops.ts` (`resolveConfiguredWorkspaceKind`, `createConfiguredExecutionWorkspace`, `recordTokenSavingsEventScoped`, `getFinopsSummaryScoped`) + coleta automática em `qmd.ts` e `codebase.ts` (`21/21` testes).
  * `@uzina/web` & `@uzina/cli`: rota `/api/finops/summary`, painel `/app/finops` + link no `CockpitShell`, MSW + `contract-drift.test.ts` (`28/28` testes) e diagnóstico de `docker` + `workspaceMode` em `uzina doctor` (`13/13` testes).
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs` (exit `0`), `pnpm turbo run build --force` (`9/9` pacotes), `node scripts/audit-tests.mjs` (`63 arquivos, 192 testes, 0 violações`).
  * `pnpm turbo run typecheck lint test --force` com `TEST_DATABASE_URL` no PostgreSQL 16 + `pgvector` live: **`34/34` tasks**, **`480 passed | 0 skipped`**.
  * `pnpm --filter @uzina/web test:e2e`: **`2 passed (14.2s)`**.
  * `browser` (`flash`): **PASS** em `/app/finops` (4 KPIs, breakdown por técnica, registro manual `12000 → 1200` atualizando para `10.800` economizados e `90% Cache Hit Rate`, `0` console errors, `0` HTTP `>= 500`, `0` overflow em Desktop Dark/Light e Mobile).
* **Marco Atingido:** **Fase 2 (Slices 7–10) 100% Concluída, Validada em Todas as Camadas e Integrada na `main`**. Próximo passo: planejamento da Fase 3 ou operação em produção.

---

## 2026-11-22 — Slice 11: Configuração Dinâmica de Motores, Embeddings Semânticos & AST Poliglota (`feat/slice-11-dynamic-engines-polyglot-ast`)

* **Entregue:**
  * `@uzina/contracts`: `src/finops.ts` (`EmbeddingEngineModeSchema`, `AstEngineModeSchema`, `EngineOptionTelemetrySchema`, `EngineConfigSchema`, `UpdateEngineConfigSchema.strict()` com `HttpUrlSchema` anti-IMDS, `EngineConfigResponseSchema`) (`152/152` testes).
  * `@uzina/core`: `src/qmd.ts` (`createSemanticE5EmbeddingProvider` `onnx-e5-small-384` com suporte bilíngue PT-BR ↔ EN, `createOllamaEmbeddingProvider` com fallback gracioso offline e `ENGINE_OPTIONS_CATALOG`) (`150/150` testes).
  * `@uzina/codebase-intel`: `src/polyglot-indexer.ts` (`.py`, `.go`, `.rs`, `.sql`, `.java`, `.cs`), integração em `scanCodebaseWorkspace(..., { astMode })` e `readSymbolSliceFromWorkspace` com `assertPathInsideWorkspace` e `redactSensitiveText` (`13/13` testes).
  * `@uzina/db`: tabela #24 `engine_configs` (`src/schema/finops.ts`), migração `0010_breezy_snowbird.sql` e inclusão em `MIGRATION_TABLE_ORDER`/`TABLE_REGISTRY` (`39 passed | 0 skipped` em PostgreSQL 16 + `pgvector` live).
  * `@uzina/mastra-runtime`: `src/finops.ts` (`getEngineConfigScoped`, `updateEngineConfigScoped`, `resolveOrganizationEmbeddingProvider`, `createOrganizationExecutionWorkspace`, `buildAutoInjectedCodebaseContext` gravando `prompt_cache`), conectados a `qmd.ts` e `codebase.ts` (`22/22` testes).
  * `@uzina/web`: `/api/finops/config` (`GET`/`PUT`/`POST`), `<EngineConfigPanel />` com matriz Consumo × Benefício em `/app/finops`, MSW + `contract-drift.test.ts` (`28/28` testes).
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs` (exit `0`), `pnpm turbo run build --force` (`9/9` pacotes), `node scripts/audit-tests.mjs` (`63 arquivos, 196 testes, 0 violações`).
  * `pnpm turbo run typecheck lint test --force` com `TEST_DATABASE_URL` no PostgreSQL 16 + `pgvector` live: **`34/34` tasks**, **`487 passed | 0 skipped`**.
  * `pnpm --filter @uzina/web test:e2e`: **`2 passed (12.5s)`**.
  * `browser` (`flash`): **PASS** em `/app/finops` (hot-reload `onnx_e5_small`, `polyglot`, `2500` persistido após reload sem restart, `7/7` cards de telemetria, `0` console errors, `0` HTTP `>= 500`, `0` overflow em Desktop Dark/Light e Mobile).
* **Próximo passo:** Planejamento da **Fase 3** ou uso operacional em produção.

---

## 2026-11-22 — Slice 12: Guia de Prontidão, Central Conversacional de Agentes, Model Tiering & Artefatos Cíclicos (`feat/slice-12-autonomous-agency-chat-onboarding`)

* **Entregue:**
  * `@uzina/contracts`: `src/agency.ts` (`AgencyAgentRoleSchema`, `ModelTierLevelSchema`, `ProjectLifecyclePhaseSchema`, `AutonomyModeSchema`, `SystemReadinessStatusSchema`, `LongTermArtifactSummarySchema`, `SliceArtifactDetailSchema`, `AgencyChatRequestSchema.strict()`, `AgencyChatResponseSchema`) (`158/158` testes).
  * `@uzina/mastra-runtime`: `src/agency.ts` (`getSystemReadinessScoped`, `resolveAgencyTeamWithTieringScoped`, `resolveProjectAgencyStateScoped`, `getAgencyOverviewScoped`, `handleAgencyChatScoped` com fluxos Greenfield, Brownfield via URL Git + AST Poliglota, Ciclo Autônomo sem pular fases com pausa em `decision_pending`, aprovação e retorno cíclico `Ciclo #2+`) + subpath `@uzina/mastra-runtime/agency` (`23/23` testes).
  * `@uzina/web`: `/api/agency/status` (`GET`), `/api/agency/chat` (`POST`), `<AgencyCommandCenter />` integrado à Torre de Controle (`/app`), MSW + `contract-drift.test.ts` (`28/28` testes).
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs` (exit `0`), `node scripts/audit-tests.mjs` (`65 arquivos, 199 testes, 0 violações`).
  * `Vitest` (9 pacotes): **`65` arquivos de teste, `494 passed | 0 skipped`**.
  * `pnpm --filter @uzina/web test:e2e`: **`2 passed (26.8s)`**.
  * `browser` (`flash`) em `http://localhost:3000/app`: **PASS** (Guia de Prontidão, Barra de Equipe com Model Tiering, Importação Brownfield via URL Git, Inspetor Duplo de Artefatos Longo Prazo & Slices, Ciclo Autônomo até Portão HITL e Retorno Cíclico `Ciclo #2`, `0` console errors, `0` HTTP `>= 500`, `0` overflow em Desktop Dark/Light e Mobile).

---

## 2026-11-22 — Slice 13: Redesign Chat-First no Topo, Estratégia Decidida pelo Arquiteto, Equipe Enxuta/Completa & Portão Visual (`feat/slice-13-chat-first-architect-strategy-visual-gate`)

* **Entregue:**
  * `@uzina/contracts`: `TeamTopologyModeSchema` (`lean_mvp | full_enterprise`), `ArchitectStrategyDecisionSchema`, `ProjectVisualFlowSummarySchema`, intents `approve_visual_flow` e `revise_visual_flow` (`159/159` testes).
  * `@uzina/mastra-runtime`: `decideOptimalAiStrategy` (Arquiteto decide a melhor estratégia para execução por IA + justificativa), geração automática de protótipo visual inicial em `design_prototypes`, guardrail `paused_at_visual_gate` em `visual_studio` e handlers de aprovação/revisão visual (`23/23` testes).
  * `@uzina/web`: redesign de `AgencyCommandCenter` e `WorkspaceBoard` com Chat amplo no topo da primeira dobra (`7/12`), Setup integrado expansível, toggle `Equipe Enxuta (MVP · 3)` vs `Completa (6)`, remoção da escolha manual de estratégia e aba `Estúdio & Protótipo` com preview `<iframe sandbox="">` ao vivo (`28/28` testes).
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs` (exit `0`), `node scripts/audit-tests.mjs` (`65 arquivos, 199 testes, 0 violações`).
  * `Vitest` (9 pacotes): **`65` arquivos de teste, `495 passed | 0 skipped`**.
  * `pnpm --filter @uzina/web test:e2e`: **`2 passed (13.4s)`**.
  * `browser` (`flash`) em `http://localhost:3000/app`: **PASS** (Chat na primeira dobra `y = 225.6px`, `Equipe Enxuta (MVP · 3)` vs `Completa (6)`, `OdontoFlow IA` criado sem estratégia manual com `Frontend-First + MSW` decidida pelo Arquiteto, preview `<iframe sandbox="">` e aprovação do Portão Visual, `0` console errors, `0` HTTP `>= 500`, `0` overflow em Desktop Dark/Light e Mobile).

---

## 2026-11-23 — Slice 14: Polimento Visual Desktop/Mobile, Fluxo Contínuo & Eliminação de Botões Mortos (`feat/slice-14-visual-ux-polish-desktop-mobile`)

* **Entregue:**
  * `@uzina/mastra-runtime` & `/api/prototypes/[id]/preview`: HTML e CSS responsivos (`grid-template-columns: repeat(auto-fit, minmax(135px, 1fr))`, `overflow-x: hidden`) eliminando scroll horizontal duplo dentro do `<iframe sandbox="">` no mobile.
  * `@uzina/web` (`AgencyCommandCenter`, `WorkspaceBoard`, `CockpitShell`, `ProjectCodebaseMap`, `ProjectStudio`, `/app/settings`, `/exec`):
    * **Desktop (`1440×900`):** calibragem da primeira dobra para que o feed do chat, chips de **Quick-Prompts** em 1 linha (`28px`) e botão **`Enviar Mensagem`** (`y + height = 870.29px <= 900px`) fiquem 100% visíveis sem rolagem da página.
    * **Mobile (`390×844`):** Switcher Segmentado no topo (`Chat IA | Estúdio | Slices`), ocultação do Kanban inferior nas abas de Chat/Estúdio (reduzindo a página de `2376px` para `1364px`), empilhamento limpo do banner de Estratégia do Arquiteto e inputs de revisão 100% largura.
    * **Eliminação de Botões Mortos / Dessincronizações:** persistência do histórico do chat por projeto (`localStorage` + `useSyncExternalStore` com `0` erros de hidratação SSR), formatação de Markdown sem asteriscos crus, estado pós-aprovação visual com CTA `Avançar p/ Contratos & TDD`, sincronização bidirecional Kanban ↔ `Slices`, clique no título do card abrindo o inspetor do Slice, árvore `HIERARQUIA (CLIENTES)` clicável na Sidebar, correção dos breadcrumbs `/app/finops` e `/code` e redirecionamento amigável em `/app/settings` e `/exec`.
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs` (exit `0`), `node scripts/audit-tests.mjs` (`65 arquivos, 199 testes, 0 violações`).
  * `pnpm --filter @uzina/web typecheck`, `lint`, `build` e `test:e2e` (`2 passed (12.7s)`).
  * `browser` (`flash`) em `http://localhost:3000/app`: **PASS** (`0` console errors mesmo após `page.reload()`, `0` HTTP `>= 500`, `0` overflow horizontal em Desktop Dark/Light `1440×900` e Mobile `390×844`).

---

## 2026-11-23 — Slice 15: Conexão Real Multi-LLM, Ping de Credenciais, Prototipação Dinâmica & Polimento Visual Global (`feat/slice-15-live-llm-connection-visual-polish-r2`)

* **Entregue:**
  * `@uzina/contracts`: `TestProviderConnectionRequestSchema`, `TestProviderConnectionResponseSchema`, `LlmExecutionModeSchema` (`live_llm | local_assisted`) e ação `invoked_live_llm` (`159/159` testes).
  * `@uzina/mastra-runtime`: novo módulo `src/llm-client.ts` (`callProviderLlmApi`, `testProviderLlmConnectionScoped`, `invokeOrganizationLlmForAgentScoped`) descriptografando chaves AES-256-GCM em memória e conectando via HTTP nativo a **Google Gemini**, **OpenAI / OpenRouter**, **Anthropic Direct** e **Ollama Local**; `inferDomainVisualBlueprint` em `src/agency.ts` gerando protótipos visuais adaptados ao domínio do projeto (`23/23` testes).
  * `@uzina/web`: rota `POST /api/providers/test`, redesign de `/app/providers` (4 cards de configuração em 1 clique, auto-preenchimento de `Base URL` e dos 7 papéis de agentes, presets `Tiering Pro + Flash` vs `100% Rápido / Free Tier` e botão `Testar Conexão Real (Ping LLM)`), badge transparente `🟢 LLM Real Ativo` vs `🟡 Modo Simulado Local` no Chat, eliminação da barra de abas duplicada no Mobile `Estúdio`, botão `← Voltar ao Chat do Projeto` (`min-h-9`) em todas as páginas operacionais, `FinOps` no `⌘K` e pré-seleção do projeto ativo no `Co-piloto Executivo`.
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs` (exit `0`), `node scripts/audit-tests.mjs` (`65 arquivos, 199 testes, 0 violações`).
  * `pnpm --filter @uzina/web typecheck`, `lint`, `test -- tests/contract-drift.test.ts` (`1 passed`), `build` e `test:e2e` (`2 passed (13.2s)`).
  * `browser` (`flash`) em `http://localhost:3000`: **PASS** (Ping HTTP real validado em `/app/providers`, protótipo visual de domínio renderizado em Desktop e Mobile sem abas duplicadas e sem overflow horizontal).
