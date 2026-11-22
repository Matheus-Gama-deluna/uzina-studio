# Dossiê do Slice 4 — `.uzina/verify`, `@uzina/security-engine` v1 & Caixa de Decisões HITL

* **Status:** `Concluído`
* **Branch:** `feat/slice-04-verify-security-engine-decisions`
* **Estratégia Aplicada:** *Vertical Slice + Dual-Mode + Contract-First + Strict TDD (Spec → Teste antes do Build)*
* **Spec de Referência:** `docs/especificacao-tecnica-fase-1-v1.1.md` (Seções 4.2 #10–#13, 5.1, 5.2, 6.2, 7.1, 7.2, 8) e `docs/adr/001-identidade-uzina-studio.md`

---

## 1. Objetivo e Escopo Estrito

Entrega o **Marco Utilizável #1** da Uzina Studio: a fábrica executa uma entrega ponta a ponta até o estágio final (`merged` ou `failed`), executando o pipeline determinístico `.uzina/verify` (typecheck/lint/build + auditoria estática de Test Anti-Patterns + testes reais + gate incremental de segurança AppSec + `verifier` independente em modo `plan` sem CoT do Builder), pausando na **Caixa de Decisões HITL** (`pr_evidence_approve`) com Pacote de Evidências completo, permitindo aprovar/solicitar ajustes/rejeitar, finalizando commit/Draft PR ou merge local e limpando o worktree, além de expor o motor autônomo `@uzina/security-engine` em modo dual-mode (embutido + CLI `uzina-sec` + aba Auditoria de Segurança).

> **Alinhamento Nominal & Entrypoints (ADR-001):**
> - No Slice 4, `@uzina/security-engine` expõe o binário standalone `uzina-sec` (`scan`, `doctor`, `install-tools`), que no Slice 6 será encapsulado por `apps/cli` como `uzina sec ...`.
> - O pipeline `.uzina/verify` é implementado pela combinação do script `scripts/audit-tests.mjs` + script `"verify"` em `package.json` raiz + estágio determinístico `stage_verify` no workflow Mastra (dispensando arquivo `.uzina/verify.ts` separado nesta fase).

### Incluído neste Slice
1. **Contratos compartilhados (`@uzina/contracts`):**
   - Inclusão de `"pr_evidence_approve"` em `WorkflowGateTypeSchema` e adição de `VerifierVerdictOutputSchema` (`workflow.ts`), além de exposição tipada de `evidencePackJson` em `DeliverableSchema` (`deliverables.ts`).
   - `src/security.ts`: schemas completos `.strict()` para auditor estático de testes (`TestAntiPatternRuleSchema`, `TestAuditFindingSchema`, `TestAuditReportSchema`), `SecurityScanStatusSchema`, `SecurityScanModeSchema`, `SecurityTargetTypeSchema`, `ScannerExecutionStatusSchema`, `ScannerExecutionRecordSchema`, `SecurityScanSummaryCountsSchema`, `PovTestStatusSchema`, `SarifLog21Schema`, `SecurityFindingDTOSchema`, `SecurityScanResultSchema`, `SecurityScanListResponseSchema`, `RunSecurityScanSchema` (sem `targetRef` de filesystem livre nem `allowlistedHosts` controlado pelo cliente), `IngestSecurityScanSchema` e `UpdateFindingTriageSchema`.
   - `src/decisions.ts`: `EvidencePackSchema`, `DecisionSchema`, `DecisionListResponseSchema`, `ResolveDecisionSchema`, `ResolveDecisionResponseSchema`, `ExecutionEventTypeSchema`, `ExecutionEventSchema` e `ExecutionEventListResponseSchema`.
2. **Auditor Estático de Test Anti-Patterns, Redação Universal & Custo (`@uzina/core` + `scripts/audit-tests.mjs`):**
   - `packages/core/src/test-auditor.ts` (browser-safe via `@uzina/core/test-auditor`, lexer TS/JS puro sem `typescript` compiler nem `node:*`): detecta `missing_assertion`, `trivial_assertion_only`, `swallowed_exception`, `arbitrary_sleep` e `duplicate_test_blocks` (3+ blocos idênticos/equivalentes fora de `test.each`/`it.each`, com supressão explícita `// @uzina-test-audit-ignore <rule>: <motivo>`).
   - `packages/core/src/test-auditor-fs.ts` (raiz `@uzina/core`): varredura recursiva de `*.test.{ts,tsx}`.
   - `scripts/audit-tests.mjs` (varre `packages/*/tests/**/*.test.{ts,tsx}` e `apps/*/tests/**/*.test.{ts,tsx}` ignorando `node_modules`, `dist`, `.next`, `.worktrees`, `e2e`) integrado ao `"verify"` no `package.json` raiz (`audit:tests`), incluindo saneamento de quaisquer testes legados dos Slices 0–3 caso necessário.
   - `packages/core/src/state-machine.ts`: adição da transição `approved -> failed` para falhas irrecuperáveis em `stage_finalize`.
   - `packages/core/src/redact.ts`: adição de `redactSensitiveText(text, knownSecrets?)` cobrindo padrões comuns (AWS, GitHub, OpenAI, Anthropic, Google, Slack, chaves PEM, JWT, strings de conexão com senha) além dos segredos explícitos.
   - `packages/core/src/cost.ts`: `estimateTokenCostUsd(modelId, tokenUsage)` (tabela estática opcional por família de modelo com fallback determinístico `0`).
3. **Banco de Dados (`@uzina/db` — Tabelas #10 a #13):**
   - `decisions`, `security_scans`, `security_findings`, `execution_events` em `packages/db/src/schema/operations.ts` + migração Drizzle `0004_*.sql`. Mantém exatamente as 13 tabelas oficiais da Spec v1.1.
4. **Pacote Autônomo `@uzina/security-engine` (`packages/security-engine`):**
   - Importa estritamente `@uzina/contracts`, `@uzina/core` e `zod` (proibição testada de importar `@uzina/db`, `@electric-sql/pglite` ou `@mastra/core`).
   - 3 scanners nativos TS (rodam sempre): `native_secrets`, `native_ddl` (DROP/TRUNCATE/DELETE sem WHERE, ALTER DROP COLUMN em migrations/SQL) e `native_slopsquatting` (inspeção determinística offline de `package.json`/lockfiles/manifests contra padrões de typosquatting/dependências suspeitas/URLs não pinadas).
   - 4 adaptadores externos (`gitleaks`, `opengrep` com fallback `semgrep`, `trivy`, `osv_scanner`) com `shell: false`, rejeição de `targetRef`/`branch` iniciados por `-`, separador `--`, `commandRunner` injetável, truncamento+redação de `stderr`, e emissão explícita de `skipped_missing_binary` no SARIF 2.1.0 + `ScannerExecutionRecord` quando ausentes.
   - **Redação Universal & Fingerprint:** calcula `fingerprint` SHA-256 **antes** da redação e aplica `redactSensitiveText` sobre **todos** os scanners, `sarifRawJson` e mensagens antes de retornar/persistir.
   - **Portas de Inversão para Triagem Contextual:** `FindingSuppressionLookup` e `SecurityTriageEvaluator` (com fallback heurístico determinístico offline quando sem LLM), aplicando 3 vereditos (`confirmed | false_positive | unknown`) e respeitando `suppressed_in_memory`.
   - **Trava DAST (`dast-guard.ts`):** aceita apenas `http:`/`https:`, exige hostname presente na allowlist de servidor (`UZINA_DAST_ALLOWLIST`), resolve DNS (`dns.lookup(..., { all: true })` injetável) e bloqueia metadata (`169.254.0.0/16`, `fd00:ec2::254`, `100.100.100.200`), `0.0.0.0`, IPv4-mapped IPv6 e IPs privados/loopback não configurados explicitamente pelo servidor.
   - **CLI stateless `uzina-sec`:** `scan`, `doctor`, `install-tools` (manifesto pinado com SHA-256 e proteção anti-ZipSlip para `~/.uzina/bin`). `--api-url` aceita `https://` (ou `http://` exclusivamente para loopback) e envia para `POST /api/security/scans/ingest` via `Authorization: Bearer <token>`.
5. **Workflow Mastra de 8 Estágios (`@uzina/mastra-runtime`):**
   - Sub-workflow `deliveryCycleWorkflow` (`id: "delivery_cycle"`): `.then(stageBuild).then(stageVerify).then(stageDecision).commit()`, orquestrado via `.dountil(deliveryCycleWorkflow, async ({ inputData }) => inputData.cycleDone === true).then(stageFinalize).commit()`, preservando `suspended.stepId` e `suspended.path`.
   - Lock heartbeat global dentro de `withDeliverableLock` (`ttlMinutes: 5`, renovação a cada 60s + `AbortController` propagado).
   - Persistência de `decisions` e `execution_events` (com emissão in-memory via `ExecutionEventBus`) em todos os portões e estágios.
   - Precedência em `stage_verify`: (1) `auditTestDirectory` -> (2) `verifyRunner` determinístico -> (3) `runSecurityScan` incremental no diff (reprova em `critical`/`high` com `triageVerdict !== "false_positive"` e `!suppressedInMemory`; `skipped_missing_binary` gera aviso sem falso verde) -> (4) `verifier` em modo `plan` isolado do CoT do Builder (`resolveVerifierProviderProfile` com fallback para `builder`, diff limitado a 32 KiB, `outputSchema: VerifierVerdictOutputSchema`). Falha com `attemptNumber < maxVerifyAttempts` retorna ao Builder; estourando `maxVerifyAttempts`, transita `verifying -> failed` e encerra o loop.
   - `stage_decision`: grava `EvidencePack` (`diffSummary.preview` limitado a 8 KiB e redigido) em `deliverables.evidencePackJson`, cria linha `pending` em `decisions` (`pr_evidence_approve`) e faz `suspend()`. `changes_requested` zera `deliverables.verify_attempts = 0` e volta ao `stage_build`; `rejected` transita `failed` e limpa worktree; `approved` avança para `stage_finalize`.
   - `stage_finalize`: `finalizeRunner` injetável dedicado (env `GH_TOKEN` permitido apenas ao binário `gh`), commit condicional, Draft PR (`git push -u origin -- <branch>` + `gh pr create --draft` + `cleanup({ deleteBranch: false })`) ou merge local seguro (`--ff-only` somente se `repoPath` limpo, senão `local_branch_ready`), atualiza `status = "merged"` e zera `worktreePath = null` no DB mesmo se `cleanup` sofrer `EBUSY`.
6. **API REST/SSE, Bearer Auth CLI, MSW, Contract Drift e UI Web (`apps/web`):**
   - Habilitação do plugin `bearer()` de `better-auth/plugins` em `apps/web/src/lib/auth.ts` mantendo as 13 tabelas intactas.
   - 7 endpoints REST/SSE:
     - `GET /api/decisions` (`READ_ROLES`, filtros `?status=&projectId=&deliverableId=&limit=`)
     - `POST /api/decisions/[id]/resolve` (`VAULT_WRITE_ROLES` para `pr_evidence_approve`, `WORKSPACE_WRITE_ROLES` para demais gates; coordenação atômica com lock + `409 DECISION_ALREADY_RESOLVED`)
     - `GET /api/security/scans` (`READ_ROLES`, paginado, sem `sarifRawJson` bruto) & `POST /api/security/scans` (`WORKSPACE_WRITE_ROLES`, alvo resolvido exclusivamente no servidor via `deliverableId`/`projectId` + `relativeSubpath` ou `UZINA_DAST_ALLOWLIST`)
     - `POST /api/security/scans/ingest` (`WORKSPACE_WRITE_ROLES` via Cookie ou `Authorization: Bearer`, payload máx. `5 MiB`)
     - `GET /api/security/scans/[id]` (`READ_ROLES`, `?includeSarif=true` opcional)
     - `PATCH /api/security/findings/[id]` (`VAULT_WRITE_ROLES` quando `suppressedInMemory === true` ou `false_positive` em `critical`/`high`; `WORKSPACE_WRITE_ROLES` nos demais)
     - `GET /api/deliverables/[id]/events` (`READ_ROLES`, escopo `organizationId`, replay inicial único + `ExecutionEventBus` in-memory sem polling PGlite, suporte `Last-Event-ID` e `?snapshot=true`)
   - `/api/deliverables/[id]/workflow/resume` sincronizado atomicamente com `decisions` dentro do mesmo lock e com a mesma regra RBAC em `pr_evidence_approve`.
   - Telas `/app/decisions` e `/app/security` + links em `CockpitShell` e `CommandPalette`.

### Explicitamente Fora de Escopo (Slices Futuros)
- **Slice 5:** Co-piloto Executivo com Mastra `.network()` (`/api/copilot/chat`), drawer global e CRUD/injeção vetorial da tabela `memories` (`org | client | project`).
- **Slice 6:** `apps/cli` completo (`uzina start`, `uzina sec`, `uzina db migrate-to-postgres`), `Dockerfile` multi-stage, `docker-compose.yml` completo, GitHub Actions de release e suíte Playwright E2E completa.

---

## 2. Fronteiras de Pacotes e Arquivos Previstos

Respeitando estritamente o grafo acíclico da Spec §3:
- `packages/contracts/src/{workflow.ts,deliverables.ts,security.ts,decisions.ts,index.ts}` + `packages/contracts/tests/slice4-contracts.test.ts`
- `packages/core/src/{state-machine.ts,redact.ts,cost.ts,test-auditor.ts,test-auditor-fs.ts,index.ts}`, `packages/core/package.json` + `packages/core/tests/{state-machine.test.ts,redact.test.ts,test-auditor.test.ts}`
- `scripts/audit-tests.mjs`, `package.json` (scripts `audit:tests` e `verify`)
- `packages/db/src/schema/{operations.ts,index.ts}`, `packages/db/src/index.ts`, `packages/db/drizzle/0004_*.sql` + `packages/db/tests/slice4-operations-schema.test.ts`
- `packages/security-engine/{package.json,tsconfig.json,vitest.config.ts,eslint.config.mjs,src/{index.ts,sarif.ts,native-scanners.ts,adapters.ts,triage.ts,dast-guard.ts,engine.ts,cli.ts},tests/{native-scanners.test.ts,adapters-sarif.test.ts,triage-dast-cli.test.ts}}`
- `packages/mastra-runtime/package.json`, `packages/mastra-runtime/src/{event-bus.ts,service.ts,workflows/deliverable-lifecycle.ts,index.ts}` + `packages/mastra-runtime/tests/slice4-verify-finalize.integration.test.ts`
- `apps/web/package.json`, `apps/web/src/lib/{auth.ts,operations-queries.ts,workflow-runtime.ts}`
- `apps/web/src/app/api/{decisions/route.ts,decisions/[id]/resolve/route.ts,security/scans/route.ts,security/scans/ingest/route.ts,security/scans/[id]/route.ts,security/findings/[id]/route.ts,deliverables/[id]/events/route.ts,deliverables/[id]/workflow/resume/route.ts}`
- `apps/web/src/app/app/{decisions/page.tsx,security/page.tsx}` + `apps/web/src/components/{decisions-workbench.tsx,security-audit-console.tsx,cockpit-shell.tsx,command-palette.tsx}`
- `apps/web/src/mocks/{fixtures.ts,handlers.ts}`, `apps/web/tests/{contract-drift.test.ts,slice4-api.test.ts}`

---

## 3. Contratos Compartilhados (`@uzina/contracts`)

- **`workflow.ts` & `deliverables.ts`:**
  - `WorkflowGateTypeSchema`: adiciona `"pr_evidence_approve"`.
  - `VerifierVerdictOutputSchema`: `{ verdict: "approved" | "changes_required", summary: string, issues: Array<{ severity: "blocker" | "major" | "minor", filePath?: string, message: string }> }`.
  - `DeliverableSchema`: passa a expor `evidencePackJson: EvidencePack | null` (ou objeto estruturado compatível) e `verifyAttempts` / `maxVerifyAttempts`.
- **`src/security.ts`:**
  - Enums/Status: `SecurityScanModeSchema` (`"embedded" | "standalone"`), `SecurityTargetTypeSchema` (`"git_repo" | "git_diff" | "container" | "staging_url"`), `SecurityScanStatusSchema` (`"running" | "completed" | "failed"`), `ScannerExecutionStatusSchema` (`"executed" | "skipped_missing_binary" | "failed"`), `PovTestStatusSchema` (`"not_applicable" | "missing" | "failing_confirmed" | "passing_fixed"`).
  - `ScannerExecutionRecordSchema`: `{ scanner, status: ScannerExecutionStatusSchema, binaryName?, installHint?, findingsCount, durationMs, errorMessage? }`.
  - `SecurityScanSummaryCountsSchema`: `{ critical, high, medium, low, info, total, suppressedCount, confirmedCount, skippedScannersCount }`.
  - `SecurityFindingDTOSchema`, `SarifLog21Schema`, `SecurityScanResultSchema` (listagem resumida sem `sarifRawJson` obrigatório + detalhe completo com `findings` e `scannerStatuses`), `SecurityScanListResponseSchema`.
  - `RunSecurityScanSchema`: `{ projectId?: uuid, deliverableId?: uuid, targetType: "git_repo" | "git_diff" | "staging_url", relativeSubpath?: string, stagingUrl?: url, scanners?: string[], triage?: boolean }` (sem `targetRef` filesystem livre nem `allowlistedHosts`).
  - `IngestSecurityScanSchema`: `{ organizationId?: uuid, projectId?: uuid, deliverableId?: uuid, targetType, targetRef, scannersRun, scannerStatuses, sarifRawJson, summaryCountsJson, findings }`.
  - `UpdateFindingTriageSchema`: `{ triageVerdict: "confirmed" | "false_positive" | "unknown", triageRationale?: string, suppressedInMemory?: boolean, povTestStatus?: PovTestStatusSchema }`.
- **`src/decisions.ts`:**
  - `EvidencePackSchema`, `DecisionSchema`, `DecisionListResponseSchema`, `ResolveDecisionSchema` (`{ status: "approved" | "changes_requested" | "rejected", humanFeedback?: string }`), `ResolveDecisionResponseSchema` (`{ decision: Decision, workflowState?: DeliverableWorkflowState }`), `ExecutionEventTypeSchema` (`"stage_change" | "tool_call" | "stuck_alert" | "verify_result" | "token_usage" | "error"`), `ExecutionEventSchema` e `ExecutionEventListResponseSchema`.

---

## 4. Persistência, Segurança e Decisões Técnicas

1. **Tabelas Drizzle (`packages/db/src/schema/operations.ts`):**
   - **`decisions`:** `id` (uuid PK), `deliverableId` (FK cascade), `mastraStepId`, `decisionType` (enum `decision_type`), `summary`, `payloadJson` (jsonb), `status` (enum `decision_status`, default `'pending'`), `humanFeedback` (nullable), `resolvedBy` (FK `users.id`, `onDelete: "set null"`, nullable), `resolvedAt` (`withTimezone: true`, nullable), `createdAt`/`updatedAt` (`withTimezone: true`). Índice `(deliverableId, status)`.
   - **`security_scans`:** `id` (uuid PK), `organizationId` (FK `organizations.id` cascade), `projectId` (FK `projects.id`, `onDelete: "set null"`, nullable), `deliverableId` (FK `deliverables.id`, `onDelete: "set null"`, nullable), `mode` (`embedded | standalone`), `targetType` (`git_repo | git_diff | container | staging_url`), `targetRef`, `scannersRun` (`text[]`), `sarifRawJson` (jsonb), `summaryCountsJson` (jsonb), `status` (`running | completed | failed`, default `'running'`), `createdAt`/`updatedAt` (`withTimezone: true`). Índice `(organizationId, createdAt)`.
   - **`security_findings`:** `id` (uuid PK), `scanId` (FK `security_scans.id` cascade), `projectId` (FK `projects.id`, `onDelete: "set null"`, nullable), `ruleId`, `scanner`, `severity` (`security_severity`), `filePath` (nullable), `lineStart` (integer, nullable), `title`, `description`, `fingerprint`, `triageVerdict` (`triage_verdict`, default `'pending'`), `triageRationale` (nullable), `suppressedInMemory` (boolean, default `false`), `povTestStatus` (`not_applicable | missing | failing_confirmed | passing_fixed`, default `'not_applicable'`), `createdAt`/`updatedAt` (`withTimezone: true`). Índices `(scanId, severity)` e `(projectId, fingerprint)`.
   - **`execution_events`:** `id` (uuid PK), `deliverableId` (FK `deliverables.id` cascade), `stage`, `actorRole`, `eventType` (`stage_change | tool_call | stuck_alert | verify_result | token_usage | error`), `tokensInput` (integer default `0`), `tokensOutput` (integer default `0`), `cacheReadTokens` (integer default `0`), `estimatedCostUsd` (`numeric(12, 6)` default `'0'`), `payloadJson` (jsonb), `createdAt` (`withTimezone: true`). Índice `(deliverableId, createdAt)`.
   - Sempre usar `.returning()` com 0 argumentos pela compatibilidade `PgliteDatabase | NodePgDatabase`.
2. **Isolamento Multi-Tenant e RBAC:**
   - Todas as consultas em `operations-queries.ts` exigem `organizationId` obrigatório com join até `clients.organizationId` ou `securityScans.organizationId`.
   - `VAULT_WRITE_ROLES` (`owner`/`admin`) obrigatório para resolver `pr_evidence_approve`, ativar `suppressedInMemory` e marcar `critical`/`high` como `false_positive`.
3. **Sem Vazamento de Erros / Sem Polling no PGlite:**
   - Respostas `500` nunca expõem `err.message`; mensagens de `WorkflowRuntimeError` são sanitizadas sem paths absolutos/SQL.
   - SSE utiliza replay inicial único + `ExecutionEventBus` in-memory + cleanup no abort.

---

## 5. Plano de Testes (*Spec → Teste* antes do Build)

* **Unitários (*Tests as Data*):**
  - `packages/contracts/tests/slice4-contracts.test.ts`
  - `packages/core/tests/{state-machine.test.ts,redact.test.ts,test-auditor.test.ts}`
  - `packages/security-engine/tests/{native-scanners.test.ts,adapters-sarif.test.ts,triage-dast-cli.test.ts}`
* **Integração (PGlite / Mastra / MSW / Contract Drift / IDOR / RBAC):**
  - `packages/db/tests/slice4-operations-schema.test.ts`
  - `packages/mastra-runtime/tests/slice4-verify-finalize.integration.test.ts`
  - `apps/web/tests/{contract-drift.test.ts,slice4-api.test.ts}`
* **QA Visual Multi-Viewport (`browser`):**
  - `/app/decisions` e `/app/security` em Desktop (`1440×900`) e Mobile (`390×844`), modos Dark & Light.

---

## 6. Critérios de Pronto (DoD)

- [x] `node scripts/check-no-ee.mjs` retorna código `0`.
- [x] `node scripts/audit-tests.mjs` retorna código `0` em todo o monorepo (`37` arquivos, `139` testes, `2` suprimidos justificados, `0` violações).
- [x] `pnpm turbo run build --force` (`7/7`, `0` warnings Turbopack) e `pnpm turbo run typecheck lint test --force` (`27/27` tasks, `368` passed | `1` skipped `postgres-live.test.ts`) passam 100%.
- [x] CLI `uzina-sec scan` e `uzina-sec doctor` executam sem abrir `./data/pgdata`, emitindo SARIF 2.1.0 com `skipped_missing_binary` explícito.
- [x] Workflow Mastra executa ciclo completo até `merged` e trata `verify` auto-fix, estouro `maxVerifyAttempts -> failed`, `changes_requested` zerando `verifyAttempts`, e `rejected -> failed` com limpeza.
- [x] Telas `/app/decisions` e `/app/security` aprovadas pelo `browser` (`PASS` em Dark & Light, Desktop `1440×900` & Mobile `390×844`, zero console errors, zero HTTP >= 500, zero overflow).
- [ ] Auditorias `test-critic`, `appsec-auditor` (`pro`) e `egm-codebase-details`, além do `factory-verifier` *(adiadas no fechamento por economia de cota a pedido do usuário após tentativas 429; Plan Gate EGM pré-código executado e aprovado)*.
- [x] Dossiê, `.uzina/slices-checklist.md`, `ROADMAP_STATUS.md` e `PROGRESS_LOG.md` atualizados e commitados.

---

## 7. Revisão EGM Pré-Código (Plan Gate)

* **Parecer Inicial (`egm-implementation-readiness` & `egm-design`):** Apontados 4 BLOCKERs/decisões arquiteturais (topologia `.dountil()` do Mastra para ciclos `verify -> build` e `changes_requested -> build`, autenticação HTTP da CLI `uzina-sec` sem quebrar PGlite single-process, separação `POST /api/security/scans` vs `/ingest`, bloqueio de `targetRef` livre e `allowlistedHosts` controlado pelo cliente), além de apontamentos CRITICAL/HIGH sobre lock heartbeat global, `approved -> failed`, RBAC `VAULT_WRITE_ROLES` para `pr_evidence_approve` e `suppressedInMemory`, coordenação atômica `decisions` vs `/workflow/resume`, redação universal + `fingerprint` pré-redação, portas de inversão em `@uzina/security-engine`, `finalizeRunner` dedicado, SSE sem polling PGlite e parser browser-safe de `test-auditor.ts`.
* **Resoluções Incorporadas:** Todas as decisões foram consolidadas nas Seções 1–4 deste Dossiê e aprovadas no plano de execução antes do início de `@uzina/contracts`.

---

## 8. Evidências Reais Pós-Código (Verify Gate)

* **`node scripts/check-no-ee.mjs`:** Exit `0` (`Nenhuma dependência ou importação comercial Mastra ee/ encontrada`).
* **`node scripts/audit-tests.mjs`:** Exit `0` (`Arquivos: 37 | Testes: 139 | Suprimidos: 2 | Violações: 0`).
* **`pnpm turbo run build --force`:** `7 successful, 7 total` (`0 cached`, `0` warnings Next.js 16.4.6 Turbopack).
* **`pnpm turbo run typecheck lint test --force`:** `27 successful, 27 total` (`0 cached`):
  - `@uzina/contracts`: `108 passed (108)` (`5` files)
  - `@uzina/core`: `137 passed (137)` (`11` files)
  - `@uzina/security-engine`: `19 passed (19)` (`3` files)
  - `@uzina/opencode-bridge`: `45 passed (45)` (`3` files)
  - `@uzina/db`: `24 passed | 1 skipped` (`postgres-live.test.ts` sem `TEST_DATABASE_URL`)
  - `@uzina/mastra-runtime`: `13 passed (13)` (`3` files)
  - `@uzina/web`: `22 passed (22)` (`6` files)
* **Smoke CLI `uzina-sec`:** `node packages/security-engine/dist/cli.js doctor` e `scan packages/core --format summary` (`exit 0`, scanners nativos executados e 4 externos marcados `skipped_missing_binary`).
* **QA Visual `browser` (`flash`):** **PASS** em `http://localhost:3044` (`/login` -> `/app` -> `/app/decisions` -> `/app/security`), Desktop `1440×900` (Dark & Light) e Mobile `390×844`, zero console errors, zero HTTP `>=500`, zero overflow horizontal.
* **Branch:** `feat/slice-04-verify-security-engine-decisions` (enviada ao `origin`).
