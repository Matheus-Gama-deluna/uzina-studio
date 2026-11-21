# Dossiê do Slice 3 — Workflow Mastra (Apache 2.0), Descoberta 5 Pilares, Strategy Router & Estúdio Visual Lite (Uzina Studio)

* **Status:** `Concluído (Verify Gate + QA Visual + Factory Verifier PASS)`
* **Branch:** `feat/slice-03-mastra-workflow-visual-studio` (base: `feat/slice-02-opencode-bridge-stuck-detector`)
* **Estratégia Aplicada:** *Contract-First + Vertical Slice + Domain-First (TDD)*
* **Spec de Referência:** `docs/especificacao-tecnica-fase-1-v1.1.md` (Seções 2, 3, 4.1, 4.2, 4.3, 5.1, 5.2, 6.2 e 8) · `.uzina/DESIGN.md` · `packages/skills/{discovery-interview,brownfield-archaeology,architecture-blueprint,visual-design-md}/SKILL.md`

---

## 1. Objetivo e Escopo Estrito

Entregar a espinha de orquestração durável do **Uzina Studio** com **Mastra Core (Apache 2.0 estrito — zero `ee/`)**, cobrindo da Descoberta de Requisitos até o início do Build Isolado + Estúdio Visual Lite:
* **Contratos Compartilhados (`@uzina/contracts`):** Schemas Zod v4 e tipos para `design_assets`, Entrevista de Descoberta (2–3 rodadas, 5 pilares), Raio-X Brownfield (Scorecard `0–100`), Strategy Router (6 estratégias + padrão tático + posse de arquivos) e estado/start/resume do `deliverableLifecycleWorkflow`.
* **Domínio Puro (`@uzina/core`):**
  * `state-machine.ts`: atualização controlada da matriz de transições para suportar rejeição humana (`-> failed`) nos estágios ativos (`discovery`, `spec_review`, `visual_studio`, `contract_tests`, `building`), além da retomada `paused -> pausedFromStatus | failed`.
  * `strategy-router.ts` (zero `node:*`, browser-safe via `./strategy-router`): roteamento determinístico entre as **6 estratégias** com matriz explícita de precedência + seleção de padrão tático (`single_agent` vs `split_lanes` somente com `allowedPaths` disjuntos).
  * `discovery.ts` (zero `node:*`, browser-safe via `./discovery`): pré-leitura silenciosa + geração de perguntas (máx. 3 rodadas, 1–4 perguntas/rodada, opção padrão recomendada) nos **5 pilares** + consolidação em `specMarkdown` e tabela de premissas.
  * `design-md.ts` (zero `node:*`, browser-safe via `./design-md`): consolidação do Moodboard (`design_assets`) e `intentionTags` em contrato `.uzina/DESIGN.md` aberto (paleta WCAG >= 4.5:1, tipografia, densidade, 5 estados e anti-padrões).
  * `brownfield.ts` (server-only via `@uzina/core` raiz, com `/*turbopackIgnore: true*/`): mapeamento somente leitura leve do repositório ignorando symlinks (`entry.isSymbolicLink()`), aplicando `assertPathInsideWorkspace`, limite `maxDepth`/`maxFiles` e `256 KiB` por manifesto, e calculando Scorecard `0–100` (5 dimensões × 20 pts, sendo `securityPosture` heurística determinística local no Slice 3 antes da integração `@uzina/security-engine` no Slice 4).
* **Reattach de Worktree (`@uzina/opencode-bridge`):**
  * Adição de `attach(existingHandle: WorktreeHandle)` em `ExecutionWorkspace` / `LocalGitWorktreeWorkspace` para reutilizar o mesmo worktree e branch entre `stage_contract_and_tests` e `stage_build` (inclusive após `suspend`/`resume` e reinício de processo), sem jamais escrever na working tree raiz do repositório.
* **Persistência & Locks (`@uzina/db`):**
  * Nova tabela `design_assets` (todas as colunas da Spec §4.2 #9 + `mime_type` e `size_bytes`) e migração SQL gerada via `drizzle-kit generate` (`0003_*.sql`).
  * Checkout atômico SQL (`packages/db/src/locks.ts`): `acquireDeliverableLock`, `releaseDeliverableLock` e `renewDeliverableLock` com TTL padrão de 5 minutos, compatíveis com PGlite e PostgreSQL.
* **Runtime Mastra (`@uzina/mastra-runtime` — novo pacote Apache 2.0 estrito):**
  * Dual-mode Storage: `LibSQLStore` (`:memory:` ou `pathToFileURL(...)`) sem `DATABASE_URL` ↔ `PostgresStore` (`schemaName: "mastra"`) com `DATABASE_URL`, via singleton `globalThis` + `closeMastraRuntime()`/`resetMastraRuntimeForTests()`.
  * `createMastraRuntime(deps)` (injeção fora do JSON snapshot) + `deliverableLifecycleWorkflow` com `stateSchema` completo e etapas `stage_discovery` → `stage_blueprint` → `stage_visual_studio` (condicional `hasUi`) → `stage_contract_and_tests` (antes do build!) → `stage_build` (loop `stuck_intervention`), sobrevivendo comprovadamente a reinício completo de processo entre `suspend` e `resume`.
* **APIs Seguras, Uploads, MSW & UI do Estúdio Visual Lite (`apps/web`):**
  * Upload multipart seguro (`Content-Length <= 5.5 MiB` pré-check + `<= 5 MiB`, magic bytes estritos PNG/JPEG/WEBP, bloqueio absoluto SVG/XSS) em `${UZINA_DATA_DIR}/uploads/<projectId>/<uuid>.<ext>`, servido exclusivamente via `GET /api/assets/[id]` autenticado + anti-IDOR + `nosniff` + `CSP sandbox`.
  * 8 rotas REST com Zod + RBAC (`READ_ROLES` / `WORKSPACE_WRITE_ROLES` bloqueando `auditor` com `403`), handlers MSW + Contract Drift Check, e página `/app/projects/[id]/studio` seguindo `.uzina/DESIGN.md` + QA Visual multi-viewport no `browser`.

### Explicitamente Fora de Escopo (Slices Futuros)
* Auditor estático de testes (`test-auditor.ts`), `@uzina/security-engine`, tabelas `decisions`, `security_scans`, `security_findings`, `execution_events`, Caixa de Decisões HITL completa e `stage_verify`/`stage_decision`/`stage_finalize` (`Slice 4`).
* Co-piloto Executivo (`.network()` / drawer SSE) e tabela `memories` (`Slice 5`).
* `apps/cli`, `Dockerfile`, `migrate-to-postgres` e suíte Playwright E2E completa (`Slice 6`).

---

## 2. Fronteiras de Pacotes, Dependências Pinadas e Arquivos Previstos

* **`scripts/check-no-ee.mjs`:** ampliar delimitador final da regex para `(["'/\s@:]|$)` cobrindo chaves de lockfile (`@mastra/*-ee@version:`).
* **`@uzina/contracts` (`packages/contracts` — ZERO deps internas):**
  * Criar `src/workflow.ts`, atualizar `src/deliverables.ts` (campos `.nullable().optional()`: `mastraRunId`, `specMarkdown`, `blueprintJson`) e `src/index.ts`.
  * Criar `tests/slice3-contracts.test.ts`.
* **`@uzina/core` (`packages/core` — importa APENAS `@uzina/contracts`):**
  * Atualizar `src/state-machine.ts` e `tests/state-machine.test.ts`.
  * Criar `src/strategy-router.ts`, `src/discovery.ts`, `src/design-md.ts`, `src/brownfield.ts`.
  * Atualizar `src/index.ts` e `package.json` (adicionar subpaths browser-safe `./strategy-router`, `./discovery`, `./design-md`).
  * Criar `tests/strategy-router.test.ts`, `tests/discovery.test.ts`, `tests/design-md.test.ts`, `tests/brownfield.test.ts`.
* **`@uzina/opencode-bridge` (`packages/opencode-bridge`):**
  * Editar `src/workspace.ts` adicionando `attach(handle)` na interface `ExecutionWorkspace` e `LocalGitWorktreeWorkspace`.
  * Expandir `tests/worktree.integration.test.ts` testando reattach em nova instância mantendo arquivos modificados/criados.
* **`@uzina/db` (`packages/db` — importa APENAS `@uzina/contracts`):**
  * Editar `src/schema/workspace.ts` (+ `designAssets`), criar `src/locks.ts`, atualizar `src/index.ts`.
  * Gerar migração `drizzle/0003_*.sql` via `drizzle-kit generate`.
  * Criar `tests/slice3-locks-assets.test.ts`.
* **`@uzina/mastra-runtime` (`packages/mastra-runtime` — importa `@uzina/contracts`, `@uzina/core`, `@uzina/db`, `@uzina/opencode-bridge`):**
  * Dependências exatas (`save-exact=true`, licença Apache-2.0): `@mastra/core@1.85.0`, `@mastra/libsql@1.31.1`, `@mastra/pg@1.37.0`, `zod@4.6.7`, pacotes workspace `@uzina/*`.
  * Arquivos: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/errors.ts`, `src/storage.ts`, `src/workflows/deliverable-lifecycle.ts`, `src/service.ts`, `src/index.ts`.
  * Testes: `tests/storage.test.ts`, `tests/workflow-restart.integration.test.ts`.
* **`apps/web` (`@uzina/web`):**
  * Editar `package.json` (+ `@uzina/mastra-runtime@workspace:*`), `next.config.ts` (`serverExternalPackages: ["@electric-sql/pglite", "pg", "@mastra/core", "@mastra/libsql", "@mastra/pg", "@libsql/client"]` + `outputFileTracingIncludes` incluindo `../../packages/skills/**/*`), `eslint.config.mjs` ou regra local impedindo import raiz de `@uzina/core` em `src/components/**`.
  * Criar `src/lib/uploads.ts`, `src/lib/workflow-runtime.ts`.
  * Atualizar `src/app/api/projects/[id]/deliverables/route.ts` (`mapDeliverable`) + `src/app/api/deliverables/[id]/route.ts` se necessário.
  * Criar 8 rotas REST (todas `runtime = "nodejs"`, `dynamic = "force-dynamic"`):
    * `src/app/api/projects/[id]/design-assets/route.ts`
    * `src/app/api/projects/[id]/design-assets/[assetId]/route.ts`
    * `src/app/api/projects/[id]/design-assets/generate-design-md/route.ts`
    * `src/app/api/assets/[id]/route.ts`
    * `src/app/api/projects/[id]/brownfield-scan/route.ts`
    * `src/app/api/deliverables/[id]/workflow/route.ts`
    * `src/app/api/deliverables/[id]/workflow/start/route.ts`
    * `src/app/api/deliverables/[id]/workflow/resume/route.ts`
  * Atualizar `src/mocks/{fixtures,handlers}.ts` e `src/components/workspace-board.tsx`.
  * Criar `src/app/app/projects/[id]/studio/page.tsx` e `src/components/project-studio.tsx`.
  * Expandir `tests/contract-drift.test.ts` e criar `tests/slice3-api.test.ts`.

---

## 3. Contratos Compartilhados (`@uzina/contracts`) & Matriz REST

### 3.1 `packages/contracts/src/workflow.ts` & `deliverables.ts`
* **`DeliverableSchema` (atualização retrocompatível):** adiciona `mastraRunId: z.string().nullable().optional()`, `specMarkdown: z.string().nullable().optional()`, `blueprintJson: z.record(z.string(), z.unknown()).nullable().optional()`.
* **`DesignAsset*`:** `DesignAssetTypeSchema`, `DesignAssetSchema`, `DesignAssetListResponseSchema = z.object({ items: z.array(DesignAssetSchema) })`, `CreateDesignAssetReferenceSchema`, `UpdateDesignAssetSchema`, `GenerateDesignMdInputSchema`, `GenerateDesignMdResponseSchema`.
* **`Discovery*` & `Brownfield*`:** `DiscoveryPillarKeySchema`, `DiscoveryQuestionSchema`, `DiscoveryAnswerSchema`, `DiscoveryRoundSchema` (`questions: min(1).max(4)`), `DiscoverySummarySchema`, `BrownfieldMaturityDimensionsSchema`, `BrownfieldScanRequestSchema = z.object({ repositoryId: z.uuid().optional() }).strict()`, `BrownfieldMapSchema`.
* **`StrategyRouter*`:** `VerticalSlicePlanSchema`, `StrategyRouterInputSchema`, `StrategyRouterOutputSchema`.
* **`Workflow*`:**
  * `WorkflowGateTypeSchema = z.enum(["discovery_confirm", "blueprint_approve", "visual_approve", "stuck_intervention"])`
  * `WorkflowResumeDecisionSchema = z.enum(["approved", "changes_requested", "rejected"])`
  * `WorkflowStartInputSchema = z.object({ initialAnswers: z.array(DiscoveryAnswerSchema).optional(), overrideStrategy: DevelopmentStrategySchema.optional() }).strict()` *(sem flag `skipWorktreeExecution` na borda HTTP!)*.
  * `WorkflowResumeInputSchema = z.object({ decision: WorkflowResumeDecisionSchema, feedback: z.string().trim().max(2000).optional(), answers: z.array(DiscoveryAnswerSchema).optional(), hasUi: z.boolean().optional(), overrideStrategy: DevelopmentStrategySchema.optional(), approveDesignMd: z.boolean().optional() }).strict()`
  * `DeliverableWorkflowStateSchema` (`deliverableId`, `runId`, `workflowStatus: z.enum(["not_started", "running", "suspended", "completed", "failed"])`, `deliverableStatus`, `suspendedStep`, `gate`, `suspendPayload`, `specMarkdown`, `blueprint`, `designMdContent`, `contractTestFiles`, `stageHistory`, `updatedAt`).

### 3.2 Matriz Completa das 8 Rotas REST

| Método & Rota | Auth / RBAC | Request (Zod / Multipart) | Response (Zod) | Status HTTP |
| :--- | :--- | :--- | :--- | :--- |
| `GET /api/projects/[id]/design-assets` | `READ_ROLES` | Query opcional `?deliverableId=` | `DesignAssetListResponseSchema` | `200`, `400`, `401`, `403`, `404` |
| `POST /api/projects/[id]/design-assets` | `WORKSPACE_WRITE_ROLES` | JSON (`CreateDesignAssetReferenceSchema`) OU `multipart/form-data` (`file`, `title`, `assetType="moodboard_image"\|"image_mockup"`, `deliverableId?`, `intentionTags` JSON/vírgula, `notes?`) | `DesignAssetSchema` | `201`, `400`, `401`, `403`, `404`, `413` |
| `PATCH /api/projects/[id]/design-assets/[assetId]` | `WORKSPACE_WRITE_ROLES` | `UpdateDesignAssetSchema` | `DesignAssetSchema` | `200`, `400`, `401`, `403`, `404` |
| `DELETE /api/projects/[id]/design-assets/[assetId]` | `WORKSPACE_WRITE_ROLES` | — (faz unlink best-effort do arquivo físico em `uploads/`) | `{ deleted: true, id }` | `200`, `400`, `401`, `403`, `404` |
| `POST /api/projects/[id]/design-assets/generate-design-md` | `WORKSPACE_WRITE_ROLES` | `GenerateDesignMdInputSchema` | `GenerateDesignMdResponseSchema` | `201`, `400`, `401`, `403`, `404` |
| `GET /api/assets/[id]` | `READ_ROLES` | — (valida tenant via `INNER JOIN projects -> clients`) | Binário com `nosniff`, `CSP sandbox`, `Content-Disposition` | `200`, `400`, `401`, `403`, `404` |
| `POST /api/projects/[id]/brownfield-scan` | `WORKSPACE_WRITE_ROLES` | `BrownfieldScanRequestSchema` (resolve `localPath` apenas do DB, nunca do body) | `BrownfieldMapSchema` | `200`, `400`, `401`, `403`, `404`, `422` |
| `GET /api/deliverables/[id]/workflow` | `READ_ROLES` | — (lê DB + `createWorkflowStateReader`) | `DeliverableWorkflowStateSchema` | `200`, `400`, `401`, `403`, `404` |
| `POST /api/deliverables/[id]/workflow/start` | `WORKSPACE_WRITE_ROLES` | `WorkflowStartInputSchema` | `DeliverableWorkflowStateSchema` | `200`, `400`, `401`, `403`, `404`, `409`, `422` |
| `POST /api/deliverables/[id]/workflow/resume` | `WORKSPACE_WRITE_ROLES` | `WorkflowResumeInputSchema` | `DeliverableWorkflowStateSchema` | `200`, `400`, `401`, `403`, `404`, `409`, `422` |

---

## 4. Domínio, Persistência, Mastra Runtime & Segurança

### 4.1 `StateMachine`, `StrategyRouter` & `brownfield.ts` (`@uzina/core`)
* **`state-machine.ts`:** permitir `-> "failed"` a partir de `["discovery", "spec_review", "visual_studio", "contract_tests", "building", "verifying", "decision_pending", "paused"]`, mantendo exatamente os demais arcos.
* **`StrategyRouter` (Precedência Determinística):**
  1. `overrideStrategy` explícito (se fornecido);
  2. `isBrownfield && (maturityScore ?? 0) < 40` → `characterization_strangler`;
  3. `hasExternalUnknownIntegration` → `spike_first`;
  4. `hasUi` → `frontend_first_msw`;
  5. `hasDatabaseSchemaChanges` → `data_schema_first`;
  6. `isPureDomainLogic && !isApiIntegration` → `domain_first`;
  7. Fallback → `api_contract_first`.
  * Padrão tático: `split_lanes` somente quando houver 2+ fatias com `allowedPaths` totalmente disjuntos (comparando normalização POSIX por prefixo/segmento de diretório — ex. `packages/a` e `packages/a/sub.ts` conflitam); caso contrário, `single_agent`.
* **`brownfield.ts` (`securityPosture` Slice 3):** 5 critérios locais (4 pts cada, máx. 20): `.gitignore` presente, lockfile presente (`pnpm-lock.yaml`/`package-lock.json`/`yarn.lock`/`poetry.lock`), ausência de arquivo `.env` exposto sem ser `.env.example`, script ou config de lint/audit presente, pasta de testes presente.

### 4.2 DDL `design_assets` & Locks SQL (`@uzina/db`)
* **`design_assets`:** `id` (uuid PK), `project_id` (`uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE`), `deliverable_id` (`uuid NULL REFERENCES deliverables(id) ON DELETE SET NULL`), `asset_type` (`text NOT NULL`), `title` (`text NOT NULL`), `source_url` (`text`), `storage_path` (`text`), `mime_type` (`text`), `size_bytes` (`integer`), `intention_tags` (`text[] NOT NULL DEFAULT '{}'`), `notes` (`text`), `approved` (`boolean NOT NULL DEFAULT false`), `created_at` (`timestamptz NOT NULL DEFAULT now()`), `updated_at` (`timestamptz NOT NULL DEFAULT now()`). Índices em `project_id` e `deliverable_id`.
* **`locks.ts` (`acquireDeliverableLock` / `renewDeliverableLock` / `releaseDeliverableLock`):**
  * `workerId` único por tentativa (`op-${crypto.randomUUID()}`).
  * SQL de aquisição usa `NOW() - make_interval(mins => ${ttlMinutes}::int)` (com validação `ttlMinutes >= 1`), `locked_by` único.
  * Retorno `boolean` (`true` se lock obtido/renovado/liberado pelo dono; `false` caso contrário).

### 4.3 Armazenamento Mastra Dual-Mode & `deliverableLifecycleWorkflow` (`@uzina/mastra-runtime`)
* **`storage.ts`:**
  * Modo local (`!DATABASE_URL`): `dataDir === ":memory:"` → `LibSQLStore({ id: "uzina-mastra", url: ":memory:" })`; senão cria diretório `dataDir` via `fs.mkdirSync(..., { recursive: true })` e usa `pathToFileURL(path.resolve(dataDir, "mastra.db")).href`.
  * Modo Postgres (`DATABASE_URL`): `PostgresStore({ id: "uzina-mastra", connectionString, schemaName: "mastra" })`.
  * Singleton `Symbol.for("@uzina/mastra-runtime/singleton")` com lock de inicialização `initPromise`, `closeMastraRuntime()` e `resetMastraRuntimeForTests()`.
* **`deliverableLifecycleWorkflow` (`stateSchema` + `createMastraRuntime(deps)`):**
  * **Dependências fora do snapshot (`deps`):** `db`, `masterKey?`, `workspaceFactory?: () => ExecutionWorkspace`, `transportFactory?: () => OpenCodeTransport`. (Nunca entram no JSON persistido pelo Mastra!).
  * **Pré-alocação de `runId`:** `startDeliverableWorkflow` verifica se já há `mastraRunId` ativo (`409` se em andamento), gera `runId = crypto.randomUUID()`, persiste `deliverables.mastraRunId = runId` **antes** de `run.start()`.
  * **Locks & Heartbeat:** `start` e `resume` executam sob `acquireDeliverableLock` (`409 Conflict`, `DELIVERABLE_LOCKED` se ocupado), renovam a cada `60s` em `stage_contract_and_tests` / `stage_build` (abortando runner se `renew` falhar), e liberam em `finally` **inclusive ao retornar `suspended`**.
  * **`stateSchema` persistido entre `suspend`/`resume`:** `{ deliverableId, organizationId, projectId, hasUi, discoveryRound, discoveryRounds, specMarkdown, blueprint, designMdContent, worktreeHandle, contractTestFiles, stageHistory, humanFeedback, rejected }`.
  * **Matriz de Transições por Gate:**
    * `stage_discovery`: `changes_requested` com `round < 3` → incrementa `discoveryRound`, grava no `state`, re-suspende; `changes_requested` em `round === 3` → erro de validação `422`; `approved` → consolida `specMarkdown` e transita `discovery -> spec_review`; `rejected` → `discovery -> failed` e chama `bail({ rejected: true })` (mapeado em `service.ts` para `workflowStatus: "failed"`).
    * `stage_blueprint`: `changes_requested` → re-executa `routeDevelopmentStrategy` com `overrideStrategy`/`feedback` e re-suspende; `approved` → `spec_review -> (hasUi ? visual_studio : contract_tests)`; `rejected` → `spec_review -> failed` + `bail({ rejected: true })`.
    * `stage_visual_studio`: se `!hasUi`, bypass direto; se `hasUi`, gera `designMdContent` de `design_assets`, salva `asset_type='design_md'` no DB + `state`, suspende `{ gate: "visual_approve" }`; `approved` → marca `design_assets.approved = true`, `projects.designMdPath = ".uzina/DESIGN.md"`, transita `visual_studio -> contract_tests`; `changes_requested` → re-gera e re-suspende; `rejected` → `visual_studio -> failed` + `bail({ rejected: true })`.
    * `stage_contract_and_tests`: verifica pré-condições (`repository` + `provider_profile` com `roleBindings.builder`, senão `422`); cria **uma única vez** o worktree via `workspace.prepare(...)` e persiste `worktreePath` / `branchName` em `deliverables` e `worktreeHandle` no `state`; grava `.uzina/DESIGN.md` **dentro do `workspacePath` do worktree** se `hasUi`; roda `OpenCodeRunner` (`mode: "build"`, `role: "builder"`, skills `["contract-first-msw", "test-quality-engineering"]`); grava `contractTestFiles` no `state`; transita `contract_tests -> building`.
    * `stage_build`: loop `while` com reattach ao mesmo worktree via `workspace.attach(worktreeHandle)` → executa `OpenCodeRunner` (`mode: "build"`, `role: "builder"`, injetando `humanFeedback` se retomado de `stuck_intervention`). Se `status === "stuck"` → transita `building -> paused` (`pausedFromStatus = "building"`) → `suspend({ gate: "stuck_intervention", stuckAlert })`; no `resume`: `approved`/`changes_requested` → limpa `pausedFromStatus`, transita `paused -> building`, injeta `feedback` e continua loop; `rejected` → transita `paused -> failed`, chama `workspace.cleanup({ deleteBranch: true })` e `bail({ rejected: true })`. Se `timed_out`/`aborted`/`error` no runner → transita `building -> paused -> failed` mantendo worktree para diagnóstico e lança erro estruturado. Se `completed` → transita `building -> verifying`.

### 4.4 Segurança de Uploads & `/api/assets/[id]` (`apps/web/src/lib/uploads.ts`)
* Pré-checagem de `Content-Length > 5_767_168` (`5.5 MiB`) antes de `request.formData()` → HTTP `413`; validação `file.size > 0 && file.size <= 5_242_880` e `buf.byteLength <= 5_242_880` (`400`/`413`).
* Magic bytes estritos (rejeita SVG/HTML/forjados):
  * PNG: min `8` bytes, `89 50 4E 47 0D 0A 1A 0A`
  * JPEG: min `4` bytes, `FF D8 FF` seguido de marcador válido (`E0|E1|E2|DB|EE|FE|C0|C2`)
  * WEBP: min `16` bytes, `RIFF` (0..3), `WEBP` (8..11) e subchunk `VP8 ` | `VP8L` | `VP8X` (12..15)
* Caminho salvo no DB: **apenas relativo** `<projectId>/<uuid>.<ext>`, contido via `assertPathInsideWorkspace(uploadsRoot, relPath)`. Em falha de DB pós-gravação, apaga arquivo criado (rollback). Em `DELETE`, faz unlink best-effort.
* `GET /api/assets/[id]`: exige `READ_ROLES`, `INNER JOIN projects -> clients` validando `organizationId` (`404` se cross-tenant ou `storagePath === null` ou ausente em disco), responde com `Content-Type` da allowlist, `Content-Disposition: inline; filename="<uuid>.<ext>"`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, max-age=300`.

---

## 5. Plano de Testes (*Spec → Teste* antes do Build)

* **Contratos (`packages/contracts/tests/slice3-contracts.test.ts`):** `test.each` cobrindo schemas válidos/limites (`DesignAsset`, `DiscoveryRound`, `BrownfieldMap`, `StrategyRouter`, `WorkflowResumeInput`, bloqueio IMDS em `sourceUrl`).
* **Domínio (`packages/core/tests/`):** `strategy-router.test.ts`, `discovery.test.ts`, `design-md.test.ts`, `brownfield.test.ts` (incluindo symlinks ignorados em `os.tmpdir()` e teste comprovando zero imports `node:*` nos subpaths browser-safe `./strategy-router`, `./discovery`, `./design-md`), e `state-machine.test.ts` atualizado.
* **Worktree Reattach (`packages/opencode-bridge/tests/worktree.integration.test.ts`):** valida `attach()` em nova instância reaproveitando o mesmo worktree e mantendo arquivos criados intactos.
* **Banco & Locks (`packages/db/tests/slice3-locks-assets.test.ts`):** exclusão mútua, expiração TTL, renovação, liberação restrita ao dono, CRUD/cascade `design_assets` em PGlite real.
* **Mastra Runtime (`packages/mastra-runtime/tests/`):**
  * `storage.test.ts`: dual-mode `LibSQLStore` (`:memory:` e disco Windows `pathToFileURL`) vs `PostgresStore` + singleton/reset.
  * `workflow-restart.integration.test.ts`: PGlite real + `LibSQLStore` em arquivo `mastra.db` + worktree Git real em `os.tmpdir()` + `InMemoryOpenCodeTransport`, testando:
    1. Sobrevivência a reinício completo (`closeMastraRuntime()` + nova instância no mesmo `mastra.db`) entre `suspend` e `resume` preservando `discoveryRounds` e `state`.
    2. Fluxo completo até `"verifying"`: `Discovery -> Blueprint -> Estúdio Visual (.uzina/DESIGN.md dentro do worktree) -> stage_contract_and_tests (antes do stage_build) -> stage_build` reutilizando o **mesmo** worktree/branch!
    3. Bypass limpo de `stage_visual_studio` quando `hasUi: false`.
    4. Fluxo `stuck_intervention` (`paused -> building`) + retomada, e `rejected` (`-> failed` + `cleanup` em `stuck_intervention`).
    5. Conflito `409`/erro quando 2 workers tentam adquirir lock simultâneo e liberação imediata ao suspender.
* **Web APIs & Contract Drift (`apps/web/tests/`):**
  * `slice3-api.test.ts`: RBAC (`403` para `auditor`), upload PNG real vs rejeição SVG/forjado/`413` `Content-Length`, `GET /api/assets/[id]` (`401`/`404` cross-tenant/`200` com `nosniff` + `sandbox`), `generate-design-md` sem repo em disco, `brownfield-scan` via DB repo, e `workflow/start` (`409` duplicado) → `workflow/resume`.
  * `contract-drift.test.ts`: expandido para cobrir `design-assets`, `generate-design-md` e `workflow` comparando MSW vs rotas reais.
* **QA Visual (`browser` `Model: "flash"`):** `/app` → `/app/projects/[id]/studio` em Dark/Light e `1280×800`, `768×1024`, `390×844`.

---

## 6. Critérios de Pronto (DoD)

1. `node scripts/check-no-ee.mjs` retorna `0` (incluindo lockfile `@mastra/*-ee`).
2. `pnpm verify` sem cache passa com `exit 0`, zero erros/warnings ESLint e zero warnings Turbopack.
3. Workflow durável sobrevive comprovadamente a reinício real (`LibSQLStore` em arquivo) entre `suspend` e `resume`, mantendo worktree compartilhado e executando `stage_contract_and_tests` antes de `stage_build`.
4. `design_assets`, upload magic-bytes em `${UZINA_DATA_DIR}/uploads/` e `GET /api/assets/[id]` anti-IDOR passam nos testes e auditoria AppSec.
5. QA Visual multi-viewport no `browser`, `test-critic`, `appsec-auditor`, `egm-codebase-details` e `factory-verifier` retornam **PASS** e docs de fase atualizados.

---

## 7. Revisão EGM Pré-Código (Plan Gate)

* **`egm-design` (3 CRITICAL, 4 HIGH, 5 MEDIUM, 3 LOW resolvidos):**
  * `[C1]` `state-machine.ts` atualizada para suportar rejeição (`-> failed`) nos estágios ativos e retomada `paused -> building | failed`.
  * `[C2]` `runId` pré-alocado no Drizzle antes de `run.start()`; adicionado `stateSchema` completo no Mastra para preservar rodadas de descoberta, worktree, arquivos e histórico entre restarts.
  * `[C3]` Adicionado `LocalGitWorktreeWorkspace.attach()` para compartilhar o mesmo worktree entre `stage_contract_and_tests` e `stage_build` (e pós-`stuck_intervention`), proibindo escrita na working tree raiz.
  * `[H1–H4]` Checkout atômico com `workerId` único por op + `make_interval` + heartbeat + liberação garantida em `finally`; remoção de `skipWorktreeExecution` da API HTTP; loop `stuck_intervention` e `bail()` em `rejected`; pré-checagem `Content-Length` + magic bytes estritos + `CSP sandbox` + rollback de upload; `brownfield.ts` ignorando symlinks e aceitando apenas `repositoryId` do DB; `WORKSPACE_WRITE_ROLES` em todas as mutações; regex estendida em `check-no-ee.mjs`.
* **`egm-implementation-readiness` (5 BLOCKERs, 6 WARNINGs resolvidos):**
  * Fechada a matriz completa das 8 rotas REST + colunas DDL de `design_assets` (`mime_type`, `size_bytes`), `.nullable().optional()` em `DeliverableSchema`, fábrica `createMastraRuntime(deps)` livre de serialização JSON de instâncias, `pathToFileURL` + `mkdirSync` para `LibSQLStore` no Windows, e `serverExternalPackages` completo.

---

## 8. Evidências Reais Pós-Código (Verify Gate)
* **Saída `node scripts/check-no-ee.mjs`:** Exit `0` (`OK [check-no-ee]: Nenhuma dependência ou importação comercial Mastra ee/ encontrada.`).
* **Saída `pnpm turbo run build typecheck lint test --force`:** Exit `0` (**24/24 tasks uncached**, `next build` 16.4.6 Turbopack com 26 rotas e `0` warnings Turbopack/ESLint):
  * `@uzina/contracts`: 4 arquivos, **86/86** passed
  * `@uzina/core`: 9 arquivos, **121/121** passed
  * `@uzina/opencode-bridge`: 3 arquivos, **45/45** passed
  * `@uzina/db`: 4 passed | 1 skipped (`postgres-live.test.ts` sem `TEST_DATABASE_URL`), **21/21** passed (`1` skipped)
  * `@uzina/mastra-runtime`: 2 arquivos, **10/10** passed (inclui sobrevivência real a restart em `LibSQLStore` em arquivo nos estágios Discovery, Blueprint, Visual Studio e `stuck_intervention` + worktree compartilhado via `attach()`)
  * `@uzina/web`: 5 arquivos, **19/19** passed (inclui Contract Drift Check MSW vs rotas PGlite e testes de magic bytes PNG/JPEG/WEBP, `413`, anti-IDOR e RBAC)
* **Resumo QA Visual (`browser` `Model: "flash"`):** **PASS** em `http://localhost:3000` (`/app` → `/app/projects/[id]/studio`, Dark & Light, `1280×800`, `768×1024`, `390×844`) — `0` erros de console, `0` respostas HTTP `>= 500`, zero overflow horizontal e fluxo E2E validado (Moodboard → `DESIGN.md` OKLCH → `discovery_confirm` → `blueprint_approve`).
* **Resumo Auditorias (`test-critic` / `appsec-auditor` / `egm-codebase-details` / `factory-verifier`):**
  * `appsec-auditor`: **PASS** (`0` CRITICAL/HIGH/MEDIUM; recomendações `LOW` aplicadas em `brownfield-scan` e `workflow-runtime`).
  * `test-critic` & `egm-codebase-details`: apontamentos `HIGH`/`MEDIUM` resolvidos (estados loading/error + painel `stuck_intervention` em `project-studio.tsx`, upload `multipart/form-data` no MSW, `intention_tags text[]` via `0003_tiresome_silver_samurai.sql`, TTL padrão `5` min, `securityPosture` 5×4 pts, pré-validação em `service.ts` e expansão completa dos testes).
  * `factory-verifier`: **PASS** após reexecução completa sem cache.
* **Branch:** `feat/slice-03-mastra-workflow-visual-studio`
