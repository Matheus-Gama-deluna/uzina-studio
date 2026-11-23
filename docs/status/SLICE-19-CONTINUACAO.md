# Guia de Continuação — Slice 19 (WIP)

> Branch: `feat/slice-19-agent-controller-workflow-bridge-kanban-auto` (criada a partir da `main` com Slice 18 já mergeado).
> Dossiê aprovado (Plan Gate EGM): `docs/slices/slice-19-agent-controller-workflow-bridge-kanban-auto.md`.
> **Não fazer merge na `main` sem autorização explícita do usuário.** Responder sempre em pt-BR.

## Objetivo
Ponte real Chat/Kanban ↔ `deliverableLifecycleWorkflow` durável, `AgentController` (5 modos), Kanban `Manual | Auto` por coluna, teto de orçamento por projeto (`budgetCapUsd`) com pausa `budget_cap_pause`, e executor de código plugável (`opencode` | `mastra_coding_agent`).

## Decisões já confirmadas
- `OpenCodeRunner` segue como executor padrão; `MastraWorkspaceExecutorAdapter` é opcional via `/app/finops` (ACP fica no Slice 20).
- Workflow real só dispara via `advance_cycle` se: `workflowService` injetado + repo em `project_repositories` + provider com `roleBindings.builder`. Senão, fallback assistido legado.
- `decision_pending` é sempre `manual` (HITL travado). Apache 2.0 estrito: `node scripts/check-no-ee.mjs` deve dar exit 0.

## Estado atual

### Feito
| Área | Situação |
|---|---|
| `@uzina/contracts` | Completo; 203/203 testes (verificado antes). |
| `@uzina/db` | Completo; migração `0011_flimsy_menace.sql`; teste PGlite verde (verificado antes). |
| `@uzina/mastra-runtime` (código) | `errors`, `finops`, `processors`, `workspace-adapter`, `background-tasks`, `controller`, `deliverable-lifecycle`, `service`, `agency`, `index` escritos. build/typecheck/lint passaram em rodada anterior. |
| Teste de integração do runtime | `packages/mastra-runtime/tests/slice19-controller-workflow-bridge.integration.test.ts` criado. Última execução: 4 passaram, 3 falharam. |
| `apps/web` rotas | Criadas: `agency/sessions/[id]/{steer,abort,plan}`, `deliverables/[id]/workflow/abort`, `projects/[id]/background-tasks`. Estendidas: projects (GET/POST/PATCH), resume, resolve, agency chat + stream, `workflow-runtime.ts`. **Não compiladas/testadas ainda.** |

### Falhas da última rodada (correções aplicadas, NÃO re-executadas)
1. `AgentsMDInjector`/`readdir` na raiz: `resolveCandidateInsideRoot` bloqueava a própria raiz (segmento vazio). Corrigido em `workspace-adapter.ts`.
2. Suite C: workflow terminou `failed` em `stage_contract_and_tests` com status `aborted` (executor retornou aborted). **Causa não investigada** — suspeitas: sinal de abort combinado (`lockWorkerContext.abortSignal`/heartbeat) abortando cedo, ou `getEngineConfigScoped`/adapter. Investigar primeiro.
3. Suite D: `resolved_by` é UUID; teste usava string. Corrigido usando usuários reais (`ownerUserId`, `devUserId`) e adicionado `backgroundTasks.waitForIdle()`.

### Pendente
- Re-rodar e fixar testes do runtime (ver falha 2).
- `apps/web`: build/typecheck/lint das rotas novas.
- MSW: `mocks/fixtures.ts` (`stageAutomation`, `budgetCapUsd`, `codingExecutorMode`, background tasks) e `mocks/handlers.ts` (PATCH projects, sessions steer/abort/plan, workflow abort, background-tasks).
- `apps/web/tests/contract-drift.test.ts`: novos endpoints + RBAC (400/401/403/404/409/422).
- UI (consultar `modern-web-guidance`: `switch`, `accessibility`, `forms`; `min-h-9`, `:focus-visible`, sem `aria-live` em estados intersticiais):
  - `deliverables-docs-hub.tsx`: toggle `Manual | Auto` (`data-testid="kanban-stage-mode-<stage>"`), cadeado `Manual (HITL)`, campo `budgetCapUsd` (owner/admin), badge de background tasks, botão `Abortar`.
  - `decisions-workbench.tsx`: rótulos `stage_gate_approve`/`budget_cap_pause` + input `newBudgetCapUsd`.
  - `agency-command-center.tsx`: SSE `controller_mode`, `workflow_started`, `background_task`, `plan_approval_required`; `Intervir (Steer)` e `Abortar`.
  - `engine-config-panel.tsx`: seletor `codingExecutorMode`.
  - `e2e/smoke.spec.ts`.
- Gate final: `node scripts/check-no-ee.mjs`, `node scripts/audit-tests.mjs`, `pnpm verify`, build standalone (`$env:UZINA_STANDALONE="1"`) e padrão, `pnpm test:e2e`.
- QA visual (subagente `browser`, Dark/Light 1440×900 e mobile 390×844), revisores (`test-critic`, `appsec-auditor`, `egm-codebase-details`, `factory-verifier`), re-rodar gate após última edição.
- Docs: dossiê (status Concluído, DoD, seção 8 com números reais), `.uzina/slices-checklist.md`, `docs/status/ROADMAP_STATUS.md`, `docs/status/PROGRESS_LOG.md`; commit pt-BR.

## Como continuar (PowerShell, sem `&&`)
```powershell
git checkout feat/slice-19-agent-controller-workflow-bridge-kanban-auto
pnpm install
pnpm --filter @uzina/contracts build
pnpm --filter @uzina/db build
pnpm --filter @uzina/mastra-runtime build; if ($LASTEXITCODE -eq 0) { pnpm --filter @uzina/mastra-runtime typecheck }; if ($LASTEXITCODE -eq 0) { pnpm --filter @uzina/mastra-runtime lint }; if ($LASTEXITCODE -eq 0) { pnpm --filter @uzina/mastra-runtime exec vitest run tests/slice19-controller-workflow-bridge.integration.test.ts }
```
Depois: corrigir a falha 2, seguir a lista Pendente na ordem acima.

## Armadilhas conhecidas
- `edit_file` troca **todas** as ocorrências do alvo; use trechos únicos.
- Windows: nunca codificar espaços como `%20` em caminhos (pasta é `_Fabrica Software`).
- ESLint proíbe `any` e `as unknown as`.
- `drizzle-kit generate` roda em CJS: schemas em `@uzina/db` só podem usar `import type` de `@uzina/contracts`.
- `@mastra/core@1.85.0`: `afterToolCall` retorna `void` (redigir saída via wrapper/`processToolResult`); `availableTools` exige nomes literais; `Session.steer()` aguarda o run sucessor (disparar sem await); `WorkspaceToolsConfig` não tem `requireReadBeforeWrite` no topo.
- `verifyAttempts` não pode ser incrementado de novo ao retomar de `budget_cap_pause` (lógica `keepCurrentAttempt` em `stage_verify`).
- `resolved_by` em `decisions` é UUID.
