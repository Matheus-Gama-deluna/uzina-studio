# Dossiê do Slice 19 — Ponte Real Chat ↔ Workflow Durável, `AgentController` & Kanban `Manual | Auto`

* **Status:** `Concluído na branch feat/slice-19-agent-controller-workflow-bridge-kanban-auto (Pronto para revisão e merge)`
* **Branch:** `feat/slice-19-agent-controller-workflow-bridge-kanban-auto`
* **Estratégia Aplicada:** `Contract-First + Domain-First + Vertical Slice` (TDD estrito sobre `@uzina/contracts`, `@uzina/db`, `@uzina/mastra-runtime` e `apps/web`)
* **Spec de Referência:** `docs/especificacao-produto-arquitetura-v2.10.md` (Seções 4, 5.2, 5.4, 5.6, 5.11, 5.12), `docs/especificacao-tecnica-fase-2-v1.0.md` e plano aprovado da Fase 3 (`implementation_plan.md`).

---

## 1. Objetivo e Escopo Estrito

### O que este Slice entrega de ponta a ponta
1. **Automação por Coluna do Kanban (`Manual | Auto`) & Pausa Inteligente por Orçamento (`budgetCapUsd`):**
   * Adiciona `stage_automation_json` (`jsonb` com `DEFAULT` explícito em nível SQL e Drizzle para compatibilidade retroativa com linhas existentes em PGlite e Postgres) e `budget_cap_usd` (`numeric(12, 6)`, nullable — mesma precisão monetária de `execution_events.estimated_cost_usd` em `operations.ts`) na tabela `projects` (migração `0011_*.sql`).
   * **Invariante de Governança HITL:** `decision_pending` é estritamente travada como `z.literal("manual")` no schema `ProjectStageAutomationSchema` — nenhuma requisição HTTP, dado legado ou UI pode tornar o portão humano `decision_pending` automático. Tanto `mapProject` quanto o runtime do workflow aplicam merge defensivo `{ ...DEFAULT_PROJECT_STAGE_AUTOMATION, ...(row.stageAutomationJson ?? {}), decision_pending: "manual" }`.
   * **Padrões seguros (`DEFAULT_PROJECT_STAGE_AUTOMATION`):**
     * `discovery`: `"manual"`, `spec_review`: `"manual"`, `visual_studio`: `"manual"`, `contract_tests`: `"auto"`, `building`: `"auto"`, `verifying`: `"auto"`, `decision_pending`: `"manual"`.
   * **Gates & Comportamento por Modo em `deliverableLifecycleWorkflow`:**
     * Adiciona `"stage_gate_approve"` e `"budget_cap_pause"` aos enums `DecisionTypeSchema` (`enums.ts`) e `WorkflowGateTypeSchema` (`workflow.ts`).
     * Quando uma etapa de planejamento/visual (`discovery`, `spec_review`, `visual_studio`) estiver em `"auto"`, o step respectivo executa com defaults recomendados (e gera `.uzina/DESIGN.md` default se `hasUi = true`) sem suspender em `suspend()`.
     * Quando `contract_tests`, `building` ou `verifying` for alternada para `"manual"` pelo usuário, o step correspondente verifica `stageAutomation[stage] === "manual"` antes de avançar/executar e, sem `resumeData`, cria decisão `"stage_gate_approve"` (com `payloadJson: { stage, gate: "stage_gate_approve" }`) e suspende no gate `"stage_gate_approve"`.
     * **Idempotência de Estado Inicial:** `stage_discovery`, `stage_blueprint` e `stage_visual_studio` inspecionam `row.status` no início: se o entregável já estiver além da etapa (ex.: slices Brownfield criados diretamente em `"spec_review"`, ou já em `"visual_studio"` / `"contract_tests"`), fazem *fast-forward/skip* seguro sem re-suspender nem tentar transição redundante (`from === to`) em `assertValidTransition`.
   * **Orçamento por Projeto (`budgetCapUsd`) com Contabilização Agregada & Intra-Step:**
     * Helper `getProjectAccumulatedCostUsd(db, projectId)` soma `COALESCE(SUM(execution_events.estimated_cost_usd), 0)` para todos os entregáveis pertencentes ao `projectId` **mais** eventos de custo do `AgentController` gravados com `projectId` em `execution_events`.
     * Verificação antes de iniciar `stage_contract_and_tests`, `stage_build` e `stage_verify`, **e callback intra-step por turno** (via `AbortController` com razão explícita `"BUDGET_CAP_EXCEEDED"`) no `OpenCodeExecutorAdapter`, `MastraWorkspaceExecutorAdapter` e `UzinaAgentController`: se `projectAccumulatedCostUsd >= project.budgetCapUsd`:
       1. Transita o entregável para `"paused"` preservando `pausedFromStatus` (`"contract_tests" | "building" | "verifying"`) e mantendo o `worktreeHandle` intacto (nunca marca como `"failed"` nem limpa o worktree);
       2. Registra decisão pendente tipo `"budget_cap_pause"` na tabela `decisions`;
       3. Chama `suspend({ gate: "budget_cap_pause", estimatedCostUsd, budgetCapUsd })`.
     * **Retomada Segura e RBAC (`VAULT_WRITE_ROLES` = `owner | admin`):**
       * Tanto `/api/decisions/[id]/resolve` quanto `/api/deliverables/[id]/workflow/resume` aceitam `newBudgetCapUsd` (extensão de `ResolveDecisionSchema` e `WorkflowResumeInputSchema`).
       * Resolver/retomar `budget_cap_pause` exige `VAULT_WRITE_ROLES` (`403` para `developer`/`auditor`; o mesmo RBAC vale para alterar `budgetCapUsd` em `PATCH /api/projects/[id]`).
       * Se `decision === "approved"`, exige `newBudgetCapUsd !== undefined && newBudgetCapUsd > projectAccumulatedCostUsd` (retornando `422 INVALID_WORKFLOW_INPUT` se ausente ou `<=`, evitando loop infinito de re-pausa), atualiza `projects.budget_cap_usd` antes do `run.resume()`, usa o `decisionType` real em `syncPendingDecisionResolution`, e em `stage_verify` **não** incrementa `verifyAttempts` novamente ao retomar de `budget_cap_pause`.
2. **Sessões Multi-Modo com `UzinaAgentController` (`@mastra/core/agent-controller` — Apache 2.0 estrito):**
   * Cria `packages/mastra-runtime/src/controller.ts` com instância singleton `Symbol.for("@uzina/mastra/controller")` em `globalThis`, acoplada ao lifecycle unificado (`service.close()` / `resetAgentControllerForTests()`).
   * **Conformidade Apache 2.0:** jamais configura `fga` ou lê `MASTRA_LICENSE_KEY` / `MASTRA_EE_LICENSE`; o controller usa estritamente Better Auth + RBAC do Uzina e valida `check-no-ee.mjs` (`exit 0`). Documenta-se que `@mastra/core/agent-controller` possui import interno de tipo `./auth/ee` no próprio `node_modules/@mastra/core/dist` que permanece inativo em modo open-source sem chave EE, sem impactar `check-no-ee.mjs` nem `tsc`.
   * **5 Modos configuráveis com `availableTools` literais exatos (sem wildcards):**
     * `discovery` (`metadata: { default: true }`, `transitionsTo: "architect"`, `availableTools: ["search_qmd_memories", "read_project_deliverables", "ask_user", "submit_plan", "task_write", "task_update", "task_complete", "task_check"]`);
     * `architect` (`transitionsTo: "build"`, `availableTools: ["search_qmd_memories", "read_project_deliverables", "inspect_codebase_skeleton", "query_codebase_symbols", "create_qmd_memory", "ask_user", "submit_plan", "task_write", "task_update", "task_complete", "task_check"]`);
     * `visual` (`availableTools: ["search_qmd_memories", "read_project_deliverables", "ask_user", "task_write", "task_update", "task_complete", "task_check"]`);
     * `build` (`availableTools: ["search_qmd_memories", "read_project_deliverables", "inspect_codebase_skeleton", "query_codebase_symbols", "create_qmd_memory", "task_write", "task_update", "task_complete", "task_check"]`);
     * `review` (`availableTools: ["search_qmd_memories", "read_project_deliverables", "inspect_codebase_skeleton", "query_codebase_symbols", "task_check"]`).
     * *(Observação: para `actor.role === "auditor"`, `create_qmd_memory` continua removida do catálogo efetivo e troca para modo com escrita ou `steer` em modo mutante retorna `403`.)*
   * **Built-in Tools & `memory`:** O `AgentController` recebe `memory` configurada do `createUzinaMemory(...)` (necessária para `threadState` das built-in tools `task_write`/`task_update`/`task_complete`/`task_check`), mantendo `subagent` desabilitado em `disableBuiltinTools: ["subagent"]` no Slice 19 para evitar loops recursivos não auditados. Não registra `TaskSignalProvider` duplicado no backing agent.
   * **Semântica de `threadLock`, `sessionId` Opaco, `steer()`, `abort()` e `submit_plan`:**
     * `sessionId` é sempre gerado no servidor (`crypto.randomUUID()` — nunca reutiliza `resourceId`). `controller.ts` mantém registro em memória (`Map<string, ManagedControllerSession>`) com `{ organizationId, projectId, createdByUserId, session, lastActivityAt }` e sweeper `timer.unref()` com TTL de inatividade (30 min) + limite LRU, além de método `destroy()` limpo no shutdown.
     * **`threadLock` desacoplado do lock SQL de entregáveis:** `AgentController.threadLock` é apenas um mutex reentrante em memória por `(threadId, controllerOwnerId)` com TTL de segurança (nunca toca `deliverables.locked_by`). Qualquer mutação real em worktree/entregável usa obrigatoriamente `acquireDeliverableLock` SQL com liberação em `finally`.
     * **Controle Assíncrono sem HTTP Hang (`untilIdle: false`):**
       * Chamadas do controller usam `untilIdle: false` por padrão para evitar deadlock com background tasks.
       * `POST /api/agency/sessions/[id]/steer` valida ownership (`404`/`403`), rejeita `auditor` em `targetMode` mutante (`403`), retorna `409 SESSION_NOT_ACTIVE` se não houver run ativo, troca modo via `await session.mode.switch({ modeId: targetMode })` (se informado), dispara o re-direcionamento desacoplado (`void session.steer({ content, requestContext }).catch(...)` em segundo plano após sinalizar abort do run atual, **sem** travar a resposta HTTP aguardando o novo turno completo do LLM) e grava auditoria/reason em `execution_events` (ou histórico da sessão).
       * `POST /api/agency/sessions/[id]/abort` valida ownership, verifica `projectId`/`deliverableId` se informados, aciona `session.abort()` (e `abortDeliverableRun` se `deliverableId` pertencer ao mesmo projeto/org) e **nunca** chama `releaseDeliverableLock` diretamente no handler HTTP — o lock SQL só é liberado no `finally` do worker após propagação do `AbortSignal`.
       * **Retomada de `submit_plan` (`tool_suspended`):** quando o controller emite `tool_suspended` para `submit_plan` / `ask_user`, o stream emite evento SSE `plan_approval_required` (`sessionId`, `toolCallId`, `planText`, `transitionModeId`), e `POST /api/agency/sessions/[id]/plan` chama `session.respondToToolSuspension({ toolCallId, resumeData })` para aprovar (`transitionsTo`) ou rejeitar com feedback.
   * **Processors Adicionais (`packages/mastra-runtime/src/processors.ts`):**
     * `AgentsMDInjector`: `isEnabled(args)` retorna `false` sempre que `requestContext?.get("workspaceRoot")` não estiver definido e validado ou quando `untrustedCheckout === true` (nunca recorre a `process.cwd()`); `getBasePath` devolve `workspaceRoot`; `getReader` passa todo path por `assertPathInsideWorkspace`, bloqueia symlinks (`lstatSync().isSymbolicLink()`) e bloqueia arquivos sensíveis (`.env*`, `.master-key`, `*.pem`, `*.key`, `.git/config`), sanitizando o conteúdo com `redactSensitiveText()` + escape `CONTROL_TAG_RE` e teto `maxTokens: 1500`.
     * `SkillsProcessor` / catálogo determinístico: carrega apenas metadados curados de `packages/skills/*/SKILL.md` (via `Workspace` ou `formatSkillsCatalog` adaptado ao schema do Slice 2 `applies_to_roles`) somente em runtime Node.js (`@uzina/mastra-runtime`, jamais em Client Components).
     * **Guarda de Orçamento por Turno:** processor customizado em `processOutputStep` que calcula custo via `estimateTokenCostUsd` de `@uzina/core` + `getProjectAccumulatedCostUsd(db, projectId)` e dispara `abort("BUDGET_CAP_EXCEEDED")` se exceder `project.budgetCapUsd`.
3. **Ponte Real Chat / Kanban ↔ `deliverableLifecycleWorkflow` + `BackgroundTasks`:**
   * Cria `packages/mastra-runtime/src/background-tasks.ts` mantendo um registro gerenciado de tarefas assíncronas por instância de runtime (`Map<taskId, ManagedBackgroundTask>` com `AbortController`, `promise`, `organizationId`, `projectId`, `deliverableId`, `mastraRunId`, `status`) sincronizado com `deliverables` e `execution_events` (permitindo reconstituir estado após cold start e drenar/abortar todas as tasks em `service.close()` / `resetWebWorkflowRuntimeForTests()` antes de fechar DB/LibSQL).
   * `service.ts` registra `backgroundTasks` e adiciona `abortDeliverableRun({ deliverableId, organizationId, reason })` (que sinaliza o `AbortController` da task ativa do entregável).
   * `agency.ts`: adiciona `workflowService?: MastraWorkflowService` opcional em `AgencyChatExecutionParams` (injetado por `getWebWorkflowRuntime()` nas rotas `POST /api/agency/chat` e `POST /api/agency/chat/stream`), aplica guard explícito `!canMutate` (`403` para `auditor` em `advance_cycle` e demais intents mutantes), e na intent `advance_cycle`:
     * **Disparo Real em Background:** ocorre quando `params.workflowService` foi fornecido **e** o projeto possui repositório vinculado em `project_repositories` **e** a organização possui provedor `builder` configurado no cofre (`provider_profiles`).
     * Seleciona **no máximo 1 entregável elegível por disparo** (prevenindo *thundering herd* de worktrees e corrida de orçamento), vincula `repositoryId` padrão do projeto caso `deliverables.repositoryId` seja nulo, respeita `mastraRunId` suspenso existente (chamando `resumeDeliverableWorkflow` se aplicável ou reportando pendência HITL sem duplicar `start`), e despacha em `backgroundTasks` respeitando `stageAutomationJson`, emitindo `workflow_started` / `background_task` / `started_workflow`.
     * **Fallback Assistido Preservado:** sem `workflowService` (testes legados Slices 12–18), sem repositório vinculado ou sem provedor `builder` configurado, preserva 100% do fluxo assistido existente sem quebrar nenhum teste anterior.
4. **Motor de Codificação Plugável (`CodingExecutorAdapter`):**
   * Adiciona `coding_executor_mode` (`text`, default `"opencode"`) em `engine_configs` (migração `0011_*.sql`, `EngineConfigSchema`, `/api/finops/config`).
   * Cria `packages/mastra-runtime/src/workspace-adapter.ts` com interface unificada `CodingExecutorAdapter` devolvendo o mesmo contrato `OpenCodeSessionResult` (`status`, `outputText`, `structuredOutput`, `touchedFiles`, `tokenUsage`, `stuckAlert`) consumido por `stage_contract_and_tests` e `stage_build`:
     * `OpenCodeExecutorAdapter` (padrão): encapsula `OpenCodeRunner` + `LocalGitWorktreeWorkspace` / `DockerExecutionWorkspace`;
     * `MastraWorkspaceExecutorAdapter`: envolve `@mastra/core/workspace` (`Workspace`) sobre uma subclasse **`UzinaContainedFilesystem extends LocalFilesystem`**:
       1. Intercepta todas as operações (`readFile`, `writeFile`, `appendFile`, `deleteFile`, `copyFile`, `moveFile`, `readdir`, `stat`, `realpath`) aplicando `assertPathInsideWorkspace(worktreePath, targetPath)` + `realpathSync.native` + blocklist de padrões sensíveis (`.env`, `.env.*`, `.master-key`, `*.pem`, `*.key`, `.git/config`, `.git/hooks/*`) tanto no caminho pedido quanto no caminho canônico — bloqueando exfiltração inclusive via `grepTool` / `list_files` / symlinks;
       2. Aplica `requireReadBeforeWrite` com normalização case-insensitive em Windows (`process.platform === "win32"`);
       3. `tools.hooks.beforeToolCall` inspeciona `input.path`, `input.src`, `input.dest`, `input.paths` e headers `---`/`+++` de `apply_patch`;
       4. **Desabilita explicitamente `sandbox` / `execute_command`** no `Workspace` (toda execução de shell/build/testes permanece exclusiva do `VerifyRunner` determinístico com `shell: false`);
       5. Como `WorkspaceToolHooks.afterToolCall` retorna `void` em `@mastra/core@1.85.0`, a sanitização das saídas das tools (`redactSensitiveValue` + `CONTROL_TAG_RE`) é executada via wrapper nas tools criadas e via `SecretRedactionProcessor.processToolResult`;
       6. Se `engine_configs.workspaceKind === "docker"` e `codingExecutorMode === "mastra_coding_agent"`, ou recusa com erro claro de pré-condição ou aplica fallback explícito documentado para `OpenCodeExecutorAdapter` no container Docker (sem jamais rodar `LocalFilesystem` fora do container quando Docker estiver exigido).
5. **Rotas API, MSW & UI Warm Stone (`apps/web`):**
   * **Novas rotas:**
     * `POST /api/agency/sessions/[id]/steer` (`WORKSPACE_WRITE_ROLES`)
     * `POST /api/agency/sessions/[id]/abort` (`WORKSPACE_WRITE_ROLES`)
     * `POST /api/agency/sessions/[id]/plan` (`WORKSPACE_WRITE_ROLES`, aprova/rejeita `submit_plan` suspenso via `respondToToolSuspension`)
     * `POST /api/deliverables/[id]/workflow/abort` (`WORKSPACE_WRITE_ROLES`, *Kill Switch* de workflow ativo no Kanban)
     * `GET /api/projects/[id]/background-tasks` (`READ_ROLES`, anti-IDOR por organização)
   * **Rotas estendidas:**
     * `GET /api/projects`, `POST /api/projects` e `PATCH /api/projects/[id]` (`stageAutomation` e `budgetCapUsd` — exigindo `VAULT_WRITE_ROLES` se `budgetCapUsd` estiver presente no payload do `PATCH`);
     * `GET/PUT /api/finops/config` (`codingExecutorMode`);
     * `POST /api/deliverables/[id]/workflow/resume` e `POST /api/decisions/[id]/resolve` (suporte a `newBudgetCapUsd` + `VAULT_WRITE_ROLES` quando `budget_cap_pause`);
     * `POST /api/agency/chat` e `POST /api/agency/chat/stream` (injeção de `workflowService: getWebWorkflowRuntime().service`).
   * **UI Warm Stone (`.uzina/DESIGN.md`):**
     * `DeliverablesDocsHub` (`/app/deliverables`): no Kanban, cada coluna elegível exibe toggle discreto **`Manual | Auto`** (`data-testid="kanban-stage-mode-<stage>"`), enquanto `Decisão HITL` exibe cadeado fixo **`Manual (HITL)`**; topo exibe controle compacto de `budgetCapUsd` (para `owner`/`admin`) + badge de tarefas em background com `refetchInterval` ativo apenas enquanto houver tasks `"running"`; cards em execução exibem botão *Kill Switch* (`Abortar`) ligado a `POST /api/deliverables/[id]/workflow/abort`.
     * `DecisionsWorkbench` (`/app/decisions`): exibe input `newBudgetCapUsd` quando `decision.decisionType === "budget_cap_pause"`.
     * `AgencyCommandCenter` (`/app`): exibe modo atual do controller, banner discreto para aprovação de plano (`submit_plan` via `/plan`), e botões **`Intervir (Steer)`** + **`Abortar`** durante streams/sessões ativas (emitindo `sessionId` logo no evento inicial `controller_mode` / `thread_ready`).
     * `EngineConfigPanel` (`/app/finops`): inclui `codingExecutorMode` no `EngineDraft` e no `PUT /api/finops/config`.
     * `apps/web/src/mocks/{fixtures,handlers}.ts`: atualiza projetos mockados com `stageAutomation` + `budgetCapUsd`, `mockEngineConfig` com `codingExecutorMode: "opencode"`, adiciona `http.patch("*/api/projects/:id")`, `http.post("*/api/agency/sessions/:id/steer")`, `abort`, `plan`, `http.post("*/api/deliverables/:id/workflow/abort")` e `http.get("*/api/projects/:id/background-tasks")`.

### Explicitamente Fora de Escopo (Slices Futuros)
* `@mastra/acp` (`AcpAgent`), `@mastra/mcp` (`MCPClient` / `MCPServer`), `WebhookSignalProvider` (GitHub/Linear), `Channels` (Slack/Telegram) e `Schedules` → **Slice 20**;
* `@mastra/core/observability` completo, `Scorers` / `Golden Dataset` e `DynamicWorkflowGraph` → **Slice 21**;
* Portal Executivo `/exec/*`, App Previews efêmeros (`@mastra/core/browser`) e Mutation Testing / PBT → **Slice 22**.

---

## 2. Fronteiras de Pacotes e Arquivos Previstos

Respeito integral às fronteiras de importação (`@uzina/contracts` → `@uzina/core` & `@uzina/db` → `@uzina/opencode-bridge` → `@uzina/mastra-runtime` → `apps/web`):
* **`@uzina/contracts`** *(zero deps internas)*:
  * `[MODIFY]` `packages/contracts/src/enums.ts` (`"stage_gate_approve"`, `"budget_cap_pause"` em `DecisionTypeSchema`)
  * `[MODIFY]` `packages/contracts/src/workflow.ts` (`StageExecutionModeSchema`, `ProjectStageAutomationSchema`, `DEFAULT_PROJECT_STAGE_AUTOMATION`, `WorkflowGateTypeSchema`, `newBudgetCapUsd` em `WorkflowResumeInputSchema`)
  * `[MODIFY]` `packages/contracts/src/decisions.ts` (`newBudgetCapUsd` em `ResolveDecisionSchema`)
  * `[MODIFY]` `packages/contracts/src/projects.ts` (`stageAutomation` e `budgetCapUsd` em `ProjectSchema` com defaults + `UpdateProjectSchema`)
  * `[MODIFY]` `packages/contracts/src/finops.ts` (`CodingExecutorModeSchema`, `codingExecutorMode` em `EngineConfigSchema` e `UpdateEngineConfigSchema`)
  * `[MODIFY]` `packages/contracts/src/agency.ts` (`AgencyControllerModeIdSchema`, schemas de `steer`/`abort`/`plan`, `BackgroundTaskSummarySchema`, `BackgroundTaskListResponseSchema`, eventos SSE `controller_mode`, `workflow_started`, `background_task`, `plan_approval_required`, e ações `started_workflow`/`budget_cap_paused`)
  * `[MODIFY]` `packages/contracts/src/index.ts`
  * `[NEW]` `packages/contracts/tests/slice19-controller-automation.test.ts`
* **`@uzina/db`**:
  * `[MODIFY]` `packages/db/src/schema/workspace.ts` (`stageAutomationJson` com default SQL + Drizzle e `budgetCapUsd` numeric `(12,6)` em `projects`)
  * `[MODIFY]` `packages/db/src/schema/finops.ts` (`codingExecutorMode` em `engineConfigs`)
  * `[NEW]` `packages/db/drizzle/0011_*.sql` + snapshot (`drizzle-kit generate`)
  * `[NEW]` `packages/db/tests/slice19-schema-migration.test.ts`
* **`@uzina/mastra-runtime`** *(Apache 2.0 estrito — zero `ee/`)*:
  * `[NEW]` `packages/mastra-runtime/src/controller.ts`
  * `[NEW]` `packages/mastra-runtime/src/workspace-adapter.ts`
  * `[NEW]` `packages/mastra-runtime/src/background-tasks.ts`
  * `[MODIFY]` `packages/mastra-runtime/src/errors.ts` (`FORBIDDEN_SESSION_ACCESS`, `SESSION_NOT_ACTIVE`, `BUDGET_CAP_EXCEEDED`, `INVALID_MODE_TRANSITION`)
  * `[MODIFY]` `packages/mastra-runtime/src/processors.ts` (`AgentsMDInjector`, `SkillsProcessor`, guarda de orçamento por turno via `estimateTokenCostUsd`)
  * `[MODIFY]` `packages/mastra-runtime/src/finops.ts` (`codingExecutorMode`, `getProjectAccumulatedCostUsd`)
  * `[MODIFY]` `packages/mastra-runtime/src/workflows/deliverable-lifecycle.ts` (idempotência de estado inicial, `stageAutomationJson`, `budget_cap_pause` sem perda de worktree e sem dupla contagem de `verifyAttempts`, uso de `CodingExecutorAdapter`)
  * `[MODIFY]` `packages/mastra-runtime/src/service.ts` (ciclo de vida `controller` + `backgroundTasks`, `resolveDecision` com `newBudgetCapUsd`, `abortDeliverableRun`)
  * `[MODIFY]` `packages/mastra-runtime/src/agency.ts` (`workflowService?: MastraWorkflowService` opcional em `AgencyChatExecutionParams`, RBAC `WRITE_ROLES` em `advance_cycle`, ponte com limite 1 entregável/repo/builder, emissão `sessionId`)
  * `[MODIFY]` `packages/mastra-runtime/src/index.ts`
  * `[NEW]` `packages/mastra-runtime/tests/slice19-controller-workflow-bridge.integration.test.ts`
* **`apps/web`**:
  * `[NEW]` `apps/web/src/app/api/agency/sessions/[id]/steer/route.ts`
  * `[NEW]` `apps/web/src/app/api/agency/sessions/[id]/abort/route.ts`
  * `[NEW]` `apps/web/src/app/api/agency/sessions/[id]/plan/route.ts`
  * `[NEW]` `apps/web/src/app/api/deliverables/[id]/workflow/abort/route.ts`
  * `[NEW]` `apps/web/src/app/api/projects/[id]/background-tasks/route.ts`
  * `[MODIFY]` `apps/web/src/app/api/projects/route.ts` & `apps/web/src/app/api/projects/[id]/route.ts`
  * `[MODIFY]` `apps/web/src/app/api/deliverables/[id]/workflow/resume/route.ts`
  * `[MODIFY]` `apps/web/src/app/api/decisions/[id]/resolve/route.ts`
  * `[MODIFY]` `apps/web/src/app/api/agency/chat/route.ts` & `apps/web/src/app/api/agency/chat/stream/route.ts`
  * `[MODIFY]` `apps/web/src/lib/workflow-runtime.ts`
  * `[MODIFY]` `apps/web/src/mocks/fixtures.ts` & `apps/web/src/mocks/handlers.ts`
  * `[MODIFY]` `apps/web/tests/contract-drift.test.ts` & `apps/web/e2e/smoke.spec.ts`
  * `[MODIFY]` `apps/web/src/components/deliverables-docs-hub.tsx`, `agency-command-center.tsx`, `engine-config-panel.tsx`, `decisions-workbench.tsx`

---

## 3. Contratos Compartilhados (`@uzina/contracts`)

### Novos Schemas & Extensões Retrocompatíveis
* `StageExecutionModeSchema`: `z.enum(["manual", "auto"])`
* `ProjectStageAutomationSchema` (`.strict()`):
  * `discovery`: `StageExecutionModeSchema.default("manual")`
  * `spec_review`: `StageExecutionModeSchema.default("manual")`
  * `visual_studio`: `StageExecutionModeSchema.default("manual")`
  * `contract_tests`: `StageExecutionModeSchema.default("auto")`
  * `building`: `StageExecutionModeSchema.default("auto")`
  * `verifying`: `StageExecutionModeSchema.default("auto")`
  * `decision_pending`: `z.literal("manual").default("manual")`
* `UpdateProjectStageAutomationSchema` (parcial para `PATCH`, mas com `decision_pending: z.literal("manual").optional()`).
* `ProjectSchema`: adiciona `stageAutomation: ProjectStageAutomationSchema.default(() => ({ ...DEFAULT_PROJECT_STAGE_AUTOMATION }))` e `budgetCapUsd: z.number().positive().max(10000).nullable().default(null)`.
* `CodingExecutorModeSchema`: `z.enum(["opencode", "mastra_coding_agent"])` (default `"opencode"` em `EngineConfigSchema`).
* `DecisionTypeSchema` & `WorkflowGateTypeSchema`: adicionam `"stage_gate_approve"` e `"budget_cap_pause"`.
* `WorkflowResumeInputSchema` & `ResolveDecisionSchema`: adicionam `newBudgetCapUsd: z.number().positive().max(10000).optional()`.
* `AgencyControllerModeIdSchema`: `z.enum(["discovery", "architect", "visual", "build", "review"])`.
* `AgencySessionSteerRequestSchema` (`.strict()`): `projectId?: uuid`, `message: string (1..4000)`, `targetMode?: AgencyControllerModeId`.
* `AgencySessionAbortRequestSchema` (`.strict()`): `projectId?: uuid`, `reason?: string (1..500)`, `deliverableId?: uuid`.
* `AgencySessionPlanDecisionRequestSchema` (`.strict()`): `toolCallId: string (1..160)`, `approved: z.boolean()`, `feedback?: string (max 2000)`.
* `AgencySessionControlResponseSchema` (`.strict()`): `ok: boolean`, `sessionId: string`, `action: "steered" | "aborted" | "plan_resolved"`, `status: "accepted" | "aborted" | "resumed"`, `mode: AgencyControllerModeId | null`.
* `BackgroundTaskSummarySchema` & `BackgroundTaskListResponseSchema`: `id`, `organizationId`, `projectId`, `deliverableId`, `kind` (`"workflow_cycle" | "brownfield_scan" | "codebase_reindex" | "security_scan"`), `status` (`"queued" | "running" | "suspended" | "completed" | "failed" | "aborted"`), `summary` (redigido), `mastraRunId`, `startedAt`, `updatedAt`.
* `AgencyStreamEventSchema`: variantes `controller_mode` (`mode`, `sessionId`), `workflow_started` (`deliverableId`, `runId`, `backgroundTaskId`), `background_task` (`task`), `plan_approval_required` (`sessionId`, `toolCallId`, `planSummary`, `transitionModeId`).

---

## 4. Persistência, Segurança e Decisões Técnicas

1. **Single-Process `globalThis`, Locks Desacoplados & Shutdown Limpo:**
   * `UzinaAgentController` (`Symbol.for("@uzina/mastra/controller")`) e `BackgroundTasksRegistry` compartilham o mesmo ciclo de vida de `MastraWorkflowService` e `workflow-runtime.ts`:
     * `service.close()`, `resetAgentControllerForTests()` e `resetWebWorkflowRuntimeForTests()` abortam todas as `backgroundTasks` em andamento, aguardam `Promise.allSettled` (com timeout curto de drenagem), executam `controller.deleteSession` / cleanup de timers `.unref()`, **antes** de fechar `mastra.shutdown()`, `closeMastraStorage()` e `closeDb()`.
   * **`threadLock` vs SQL Lock:** `AgentController.threadLock` nunca toca `deliverables.locked_by`; ele protege apenas manipulação da thread em memória. Qualquer escrita em worktree/entregável usa `acquireDeliverableLock` SQL e libera apenas no `finally` do runner/workflow (nunca diretamente em handler HTTP de `/abort`).
2. **Anti-IDOR, Opacidade de Sessão & RBAC:**
   * `sessionId` é sempre `crypto.randomUUID()` server-side; consultas cross-tenant ou inexistentes em `/sessions/[id]/*` retornam uniformemente `404 SESSION_NOT_FOUND` (sem oracle de existência).
   * `deliverableId` em `/abort` é validado via JOIN com `(organizationId, projectId)` da sessão.
   * `advance_cycle` exige `WRITE_ROLES` (`403` para `auditor`).
   * Alterar `budgetCapUsd` em `PATCH /api/projects/[id]` ou resolver/retomar `budget_cap_pause` exige `VAULT_WRITE_ROLES` (`owner`, `admin`).
3. **Contenção de Filesystem (Windows-Safe & Zero Shell no Workspace Agent):**
   * `UzinaContainedFilesystem extends LocalFilesystem` valida toda operação (`readFile`, `writeFile`, `appendFile`, `deleteFile`, `copyFile`, `moveFile`, `readdir`, `stat`, `realpath`) com `assertPathInsideWorkspace` + `realpathSync.native` + blocklist de `.env*`, `.master-key`, `*.pem`, `*.key`, `.git/config`, `.git/hooks/*` (fechando bypass via `grep`, `list_files` e symlinks).
   * `requireReadBeforeWrite` normaliza caminhos em lowercase no Windows (`win32`).
   * `tools.hooks.beforeToolCall` inspeciona argumentos e patches multi-arquivo (`---`/`+++` de `apply_patch`), enquanto `SecretRedactionProcessor.processToolResult` e wrappers de tool sanitizam os retornos (visto que `afterToolCall` retorna `void`).
   * `sandbox` / `execute_command` ficam desabilitados no `MastraWorkspaceExecutorAdapter`; `AgentsMDInjector` permanece desabilitado sem `worktreePath` confiável explícito (nunca lê `process.cwd()`).
4. **Conformidade Apache 2.0 & Retrocompatibilidade Total:**
   * `node scripts/check-no-ee.mjs` deve retornar `exit 0`; zero mutação global de `process.env`; zero `any` ou `as unknown as`; testes dos Slices 0–18 permanecem intactos via DI opcional de `workflowService` e fallback determinístico sem repositório/provedor `builder`.

---

## 5. Plano de Testes (*Spec → Teste* antes do Build)

* **Unitários (`packages/contracts/tests/slice19-controller-automation.test.ts` — *Tests as Data* com `test.each`):**
  * Validação `.strict()` de `ProjectStageAutomationSchema` (rejeitando `decision_pending: "auto"`), `UpdateProjectStageAutomationSchema`, `AgencySessionSteerRequestSchema`, `AgencySessionAbortRequestSchema`, `AgencySessionPlanDecisionRequestSchema`, `CodingExecutorModeSchema`, `ResolveDecisionSchema` (`newBudgetCapUsd`), `WorkflowResumeInputSchema`, `BackgroundTaskSummarySchema` e novas variantes de `AgencyStreamEventSchema`.
* **Schema & Migração (`packages/db/tests/slice19-schema-migration.test.ts`):**
  * Aplica migrações `0000..0011` em PGlite limpo, valida `DEFAULT` SQL em `projects.stage_automation_json`, `budget_cap_usd = null`, `engine_configs.coding_executor_mode = "opencode"`, e atualização persistida.
* **Integração Runtime (`packages/mastra-runtime/tests/slice19-controller-workflow-bridge.integration.test.ts`):**
  1. `UzinaAgentController` alterna `discovery -> architect` via `submit_plan` + `respondToToolSuspension`, impõe `availableTools` literais em `review`, aplica `steer()` não bloqueante e `abort()`, isola sessões (`404`/`403` cross-tenant, `auditor` bloqueado em modo mutante) e drena `threadLock` + `backgroundTasks` no teardown.
  2. `AgentsMDInjector` lê `AGENTS.md` apenas com `workspaceRoot` confiável e recusa `../` / `.env` / symlinks; `UzinaContainedFilesystem` bloqueia `.env`/`.git/config`/case-bypass no `grep`, `readFile` e `apply_patch`, e redige segredos na saída das tools.
  3. Ponte `agency.ts` (`advance_cycle`) com `workflowService` + repo Git temp + provider `builder` dispara `deliverableLifecycleWorkflow` em background (máx. 1 por disparo), respeita `stageAutomationJson` (`"auto"` avança sem `suspend`, `"manual"` suspende em `"stage_gate_approve"`, slices em `spec_review` fazem skip idempotente) e preserva fallback legado sem `workflowService`.
  4. **Pausa por Orçamento Agregado:** `getProjectAccumulatedCostUsd` soma `execution_events` do projeto; ao atingir `budgetCapUsd` em `stage_build` ou `stage_verify`, aborta via `"BUDGET_CAP_EXCEEDED"`, preserva worktree em `"paused"`, cria decisão `"budget_cap_pause"`, bloqueia `developer` (`403`), bloqueia `newBudgetCapUsd <= accumulated` (`422`), e retoma com `owner`/`admin` + `newBudgetCapUsd` válido **sem** incrementar `verifyAttempts` novamente.
* **Contract Drift & E2E (`apps/web/tests/contract-drift.test.ts` & `apps/web/e2e/smoke.spec.ts`):**
  * MSW vs rotas reais para `PATCH /api/projects/[id]` (`stageAutomation` + `400` em `decision_pending: "auto"` + `403` `developer` alterando `budgetCapUsd`), `PUT /api/finops/config` (`codingExecutorMode`), `GET /api/projects/[id]/background-tasks`, `POST /api/deliverables/[id]/workflow/abort` e `/api/agency/sessions/[id]/{steer,abort,plan}` (`401`/`404`/`409`).
  * Smoke E2E Playwright validando toggle `Manual | Auto` em `/app/deliverables` e seletor `codingExecutorMode` em `/app/finops`.

---

## 6. Critérios de Pronto (DoD)

- [x] `node scripts/check-no-ee.mjs` retorna `exit 0` (zero imports `ee/` no código do monorepo).
- [x] Migração Drizzle `0011_*.sql` (`0011_flimsy_menace.sql`) gerada via `drizzle-kit generate`, aplicada automaticamente em PGlite e testada.
- [x] `pnpm verify` verde sem violações de `audit:tests`, zero erros TS/ESLint, build Next.js completo (`+ UZINA_STANDALONE=1`) passando.
- [x] `pnpm test:e2e` (Playwright) verde contra build de produção.
- [x] QA Visual (`browser`) em `/app`, `/app/deliverables` (Kanban `Manual | Auto` + `budgetCapUsd` + Kill Switch), `/app/decisions` (`budget_cap_pause` + `newBudgetCapUsd`) e `/app/finops` (Dark/Light Stone `1440×900` e Mobile `390×844`) com `0` erros de console, `0` HTTP `>= 500` e `0` overflow horizontal.
- [x] Revisões independentes executadas e apontamentos bloqueantes endereçados e revalidados no gate final (`test-critic`, `appsec-auditor`, `egm-codebase-details`, `factory-verifier`).

---

## 7. Revisão EGM Pré-Código (Plan Gate)

* **`egm-implementation-readiness` & `egm-design` (Plan Gate Crítico — Achados Consolidados):**
  * **`afterToolCall` vs Redação Real:** corrigido após inspeção de `@mastra/core/dist/workspace/tools/types.d.ts` (`afterToolCall` retorna `void`); redação de saída movida para wrapper de tool + `SecretRedactionProcessor.processToolResult`.
  * **Semântica Real de `AgentController`:** eliminados wildcards de `availableTools` em favor de arrays literais; removida duplicação `TaskSignalProvider` + `memory` configurada; adicionada rota `/api/agency/sessions/[id]/plan` para `submit_plan` (`respondToToolSuspension`); `steer()` desacoplado de await de turno completo e `untilIdle: false` para impedir HTTP hang/deadlock; `threadLock` em memória separado de `deliverables.locked_by` SQL.
  * **Segurança & Lifecycle:** `sessionId` opaco `randomUUID()` + retorno uniforme `404` cross-tenant; `/abort` não libera lock SQL prematuramente; `UzinaContainedFilesystem` fecha bypass Windows (case/8.3/ADS/symlinks) e leitura via `grep`/`apply_patch`, com `sandbox`/`execute_command` desabilitados; `AgentsMDInjector` desabilitado sem `worktreePath` confiável; registro e drenagem de `backgroundTasks` e sessões no shutdown (`close()` / testes).
  * **Orçamento Agregado & Gates Completos:** `budgetCapUsd` (`numeric(12,6)`) agregado por projeto via `execution_events` + abort `"BUDGET_CAP_EXCEEDED"` preservando worktree; `ResolveDecisionSchema` estendido com `newBudgetCapUsd`; RBAC `VAULT_WRITE_ROLES` para elevar teto; `syncPendingDecisionResolution` parametrizado e sem dupla contagem de `verifyAttempts`; adicionado `"stage_gate_approve"` e idempotência de estado inicial em `deliverable-lifecycle.ts`; bloqueio RBAC explícito de `auditor` em `advance_cycle`; ponte `advance_cycle` condicionada a `workflowService` + repo + `builder` com limite 1 entregável por vez.

---

## 8. Evidências Reais Pós-Código (Verify Gate)

* **`node scripts/check-no-ee.mjs`:** `OK [check-no-ee]: Nenhuma dependência ou importação comercial Mastra ee/ encontrada.` (`exit 0`).
* **`node scripts/audit-tests.mjs`:** `Arquivos: 70 | Testes: 224 | Suprimidos: 2 | Violações: 0` (`exit 0`).
* **`pnpm verify` (sem erros TS/ESLint, 34/34 tasks Turbo PASS):**
  * `@uzina/contracts`: `13` arquivos · `203 passed` (`slice19-controller-automation.test.ts` `23/23`)
  * `@uzina/core`: `13` arquivos · `157 passed`
  * `@uzina/db`: `12 passed | 1 skipped` · `39 passed | 1 skipped` (`postgres-live.test.ts` sem `TEST_DATABASE_URL`; inclui `slice19-schema-migration.test.ts`)
  * `@uzina/codebase-intel`: `1` arquivo · `13 passed`
  * `@uzina/opencode-bridge`: `4` arquivos · `51 passed`
  * `@uzina/security-engine`: `3` arquivos · `19 passed`
  * `@uzina/cli`: `1` arquivo · `13 passed`
  * `@uzina/mastra-runtime`: `11` arquivos · `35 passed` (`slice19-controller-workflow-bridge.integration.test.ts` `7/7`, incluindo execução reativa real de `AgentsMDInjector` + `sendSignal`, fluxos `resolveSessionPlanScoped`, 5 modos, `advance_cycle` ↔ `deliverableLifecycleWorkflow` + Kanban `Manual | Auto` e `budget_cap_pause`)
  * `@uzina/web`: `11` arquivos · `28 passed` (`contract-drift.test.ts` com `PATCH /api/projects/[id]`, RBAC `401`/`403`/`404`, `WorkflowAbortResponseSchema`, `GET /api/projects/[id]/background-tasks`, `PUT /api/finops/config` e `/api/agency/sessions/[id]/{steer,abort,plan}`)
  * **Total Vitest:** `558 passed | 1 skipped` (`postgres-live.test.ts` sem `TEST_DATABASE_URL`).
* **Builds & E2E:** `UZINA_STANDALONE=1` + build padrão `@uzina/web` aprovados (`exit 0`); `pnpm test:e2e` (`Playwright` contra servidor de produção PGlite): `2 passed (22.1s)` cobrindo Kanban `Manual | Auto` + trava `Manual (HITL)` e `engine-coding-executor-select`.
* **QA Visual (`browser`, `Model: "flash"`, `http://127.0.0.1:3019`):** **PASS** em `/app` (`controller-mode-badge`, `Intervir (Steer)`, `Abortar`), `/app/deliverables` (Kanban switches + `Manual (HITL)` + `Teto Orçamento (USD)` + badge de tarefas em 2º plano), `/app/decisions` e `/app/finops` (`Executor de Codificação`) em Dark/Light Stone `1440×900` e Mobile `390×844` (`0` erros de console, `0` HTTP `>= 500` em 130 requisições, `0` overflow horizontal).
* **Revisores Independentes & Remediação Final:** após apontamentos iniciais de `test-critic`, `appsec-auditor`, `egm-codebase-details` e `factory-verifier`, foram corrigidos o drift `WorkflowAbortResponseSchema` entre `@uzina/contracts`, `workflow/abort/route.ts`, MSW e `contract-drift.test.ts`, endurecimentos AppSec em `service.ts` (`validateAndApplyBudgetCapOnResume` fail-closed), `controller.ts` (bloqueio incondicional de `auditor` em `steer`), `background-tasks.ts` (join multi-tenant + redação), `processors.ts` (regex `.git/(config|hooks)` com subcaminhos) e erros genéricos `500` em chat/stream, além da execução reativa real de `AgentsMDInjector` e `resolveSessionPlanScoped` — todos revalidados no gate final após a última edição.
