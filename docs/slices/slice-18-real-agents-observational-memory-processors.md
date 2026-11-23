# Dossiê do Slice 18 — Cérebro Agêntico Real, Observational Memory & Guardrails Processors

* **Status:** `Concluído (Verify Gate + QA Visual + Revisores PASS)`
* **Branch:** `feat/slice-18-real-agents-observational-memory-processors`
* **Estratégia Aplicada:** `Contract-First + Domain-First + Vertical Slice` (TDD estrito sobre `@uzina/contracts`, `@uzina/mastra-runtime` e `apps/web`)
* **Spec de Referência:** `docs/especificacao-produto-arquitetura-v2.10.md` (Seções 4, 5.2, 5.3.B, 5.6, 5.12), `docs/especificacao-tecnica-fase-2-v1.0.md` e plano aprovado da Fase 3.

---

## 1. Objetivo e Escopo Estrito

### O que este Slice entrega de ponta a ponta
1. **Ponte Multi-Tenant Segura do Cofre AES-256-GCM para o Mastra (`model-resolver.ts`):**
   * Resolve configurações `OpenAICompatibleConfig` (`{ id, url, apiKey }`) por organização/papel diretamente do cofre `provider_profiles` em memória via `RequestContext`, **sem nunca mutar `process.env`** e mantendo `ModelRouterLanguageModel.serializeForSpan()` livre de segredos.
   * Suporta Google Gemini, Anthropic, OpenAI/OpenRouter, OmniRoute e Ollama, com fallback gracioso para o modo determinístico offline (`local_assisted`) quando nenhuma credencial estiver configurada.
2. **Memória em Duas Camadas (`@mastra/memory@1.41.2` + QMD Híbrido):**
   * **Camada Episódica/Sessão (`memory-runtime.ts`):** `Memory` sobre o storage singleton `LibSQLStore` ↔ `PostgresStore` (`getMastraStorageSingleton()`), com `observationalMemory` (`scope: "thread"`, Observer + Reflector assíncronos via `canUseProvider` + `resolveModel`, `threadTitle: true`, `hooks.beforeObservation` e `hooks.afterObservation` aplicando `redactSensitiveText`, e `hooks.onObservationEnd` opcional registrando economia de contexto em FinOps).
   * **Camada Institucional (`workspace-tools.ts`):** expõe nosso motor **QMD Híbrido** (`searchQmdScoped`, `createMemoryScoped`), **Codebase Intelligence** (`@uzina/codebase-intel` somente leitura) e **Estado de Entregas/Slices** como tools tipadas via `createTool()` com RBAC verificado no servidor.
3. **Pilha de Guardrails Processors (`processors.ts`):**
   * `SecretRedactionProcessor` (custom `Processor` usando `redactSensitiveText` do `@uzina/core` nos limites de entrada/saída/persistência);
   * `ToolSearchProcessor` (`storage: "context"`, `autoLoad: true`) quando configurado em conjuntos amplos de tools;
   * `TokenLimiter` para proteção da janela de contexto;
   * `ProviderHistoryCompat` + `StreamErrorRetryProcessor` em `errorProcessors`.
4. **Agentes Reais & Streaming SSE (`engineering-agents.ts`, `executive-copilot.ts`, `agency.ts`):**
   * `createEngineeringSpecialistAgent` por papel (`orchestrator`, `product_discovery`, `software_architect`, `ux_designer`, `tech_lead`, `qa_appsec`) com Model Tiering;
   * `streamExecutiveCopilot()` conectado ao `Agent` real (`agent.stream()`) quando há provedor ativo no cofre (ou `modelOverride` em testes), preservando rigorosamente o bloqueio de `fs_write`, `shell_exec`, `git_commit_or_push` e `status_merged_without_decision`, e mantendo o fallback determinístico offline quando sem provedor;
   * `handleAgencyChatScoped()` + `streamAgencyChatScoped()` persistindo mensagens em threads server-side no storage do Mastra (`listAgencyThreadsScoped` / `getAgencyThreadMessagesScoped`), mantendo **100% de retrocompatibilidade** com os fluxos determinísticos Greenfield/Brownfield/Visual/Ciclo quando em modo `local_assisted` ou em testes existentes sem chave LLM.
5. **Rotas API, MSW & UI (`apps/web`):**
   * `POST /api/agency/chat/stream` (SSE `text/event-stream` com cancelamento por `request.signal`);
   * `GET /api/agency/threads` (listagem de threads da organização/projeto + mensagens de uma thread validada por ownership);
   * Atualização de `/api/copilot/chat` para passar `masterKey: tryGetServerMasterKey()`;
   * Atualização de `apps/web/src/mocks/handlers.ts` e `apps/web/tests/contract-drift.test.ts`;
   * Atualização de `AgencyCommandCenter` e `CopilotDrawer` para consumir streaming SSE real, carregar threads persistidas no servidor (com fallback resiliente) e exibir indicador discreto `data-om-status` + badge `LLM Real` vs `Assistido Local` dentro do sistema Warm Stone (`.uzina/DESIGN.md`).

### Explicitamente Fora de Escopo (Slices Futuros)
* `AgentController`, `steer()`, `TaskSignalProvider`, `BackgroundTasks` e toggle `Manual | Auto` por coluna no Kanban → **Slice 19**;
* `MCPClient` / `MCPServer` (`@mastra/mcp`), `WebhookSignalProvider` (GitHub/Linear), `Channels` (Slack/Telegram) e `Schedules` → **Slice 20**;
* `@mastra/core/observability` completo, `Scorers`/`Datasets` e `DynamicWorkflowGraph` → **Slice 21**;
* Portal do Cliente `/exec/c/:clientSlug`, App Previews efêmeros e Mutation Testing/PBT → **Slice 22**.

---

## 2. Fronteiras de Pacotes e Arquivos Previstos

Respeito integral às fronteiras de importação (`@uzina/contracts` → `@uzina/core` & `@uzina/db` → `@uzina/mastra-runtime` → `apps/web`):
* **`@uzina/contracts`** *(zero deps internas)*:
  * `[MODIFY]` `packages/contracts/src/agency.ts`
  * `[MODIFY]` `packages/contracts/src/copilot.ts`
  * `[NEW]` `packages/contracts/tests/slice18-agents-memory.test.ts`
* **`@uzina/mastra-runtime`** *(Apache 2.0 estrito — zero `ee/`)*:
  * `[MODIFY]` `packages/mastra-runtime/package.json` (`@mastra/memory@1.41.2` exato)
  * `[NEW]` `packages/mastra-runtime/src/model-resolver.ts`
  * `[NEW]` `packages/mastra-runtime/src/memory-runtime.ts`
  * `[NEW]` `packages/mastra-runtime/src/processors.ts`
  * `[NEW]` `packages/mastra-runtime/src/tools/workspace-tools.ts`
  * `[NEW]` `packages/mastra-runtime/src/agents/engineering-agents.ts`
  * `[MODIFY]` `packages/mastra-runtime/src/agents/executive-copilot.ts`
  * `[MODIFY]` `packages/mastra-runtime/src/agency.ts`
  * `[MODIFY]` `packages/mastra-runtime/src/index.ts`
  * `[NEW]` `packages/mastra-runtime/tests/slice18-real-agents-om.integration.test.ts`
* **`apps/web`**:
  * `[MODIFY]` `apps/web/next.config.ts` (adicionar `"@mastra/memory"` em `serverExternalPackages`)
  * `[NEW]` `apps/web/src/app/api/agency/chat/stream/route.ts`
  * `[NEW]` `apps/web/src/app/api/agency/threads/route.ts`
  * `[MODIFY]` `apps/web/src/app/api/copilot/chat/route.ts`
  * `[MODIFY]` `apps/web/src/mocks/handlers.ts`
  * `[MODIFY]` `apps/web/tests/contract-drift.test.ts`
  * `[MODIFY]` `apps/web/src/components/agency-command-center.tsx`
  * `[MODIFY]` `apps/web/src/components/copilot-drawer.tsx`

---

## 3. Contratos Compartilhados (`@uzina/contracts`)

### Novos Schemas & Extensões Retrocompatíveis
* `ObservationalMemoryStatusSchema`:
  * `activeMessageTokens: number`, `messageTokensThreshold: number`, `activeObservationTokens: number`, `observationTokensThreshold: number`, `generationCount: number`, `bufferingStatus: "idle" | "running" | "complete"`.
* `AgencyThreadSummarySchema`:
  * `threadId: string`, `projectId: string | null`, `title: string | null`, `updatedAt: datetime`, `messageCount: number`.
* `AgencyThreadMessageItemSchema`:
  * `id: string`, `role: "user" | "assistant"`, `content: string`, `createdAt: datetime`, e opcionais `agentRole?: AgencyAgentRole`, `agentName?: string`, `executionMode?: LlmExecutionMode`, `boundModelId?: string`, `toolsUsed?: string[]`, `actionsExecuted?: AgencyActionExecuted[]`.
* `AgencyThreadListResponseSchema` (`.strict()`):
  * `threads: AgencyThreadSummary[]`, `activeThreadId: string | null`, `messages: AgencyThreadMessageItem[]`.
* `AgencyStreamEventSchema` (discriminated union por `type`):
  * `thread_ready` (`threadId`, `executionMode`, `activeAgent`, `handedOffFrom`)
  * `tool_call` (`toolName`, `input`)
  * `tool_result` (`toolName`, `output`)
  * `token` (`text`)
  * `om_status` (`status: ObservationalMemoryStatus`)
  * `action_executed` (`action: AgencyActionExecuted`)
  * `done` (`response: AgencyChatResponse`)
  * `error` (`code`, `message`)
* Extensões opcionais retrocompatíveis:
  * `AgencyChatRequestSchema`: `threadId: z.string().trim().min(1).max(160).optional()`
  * `AgencyChatResponseSchema`: `threadId: z.string().nullable().optional()`, `toolsUsed: z.array(z.string()).optional()`, `omStatus: ObservationalMemoryStatusSchema.nullable().optional()`
  * `CopilotChatRequestSchema`: `threadId: z.string().trim().min(1).max(160).optional()`
  * `CopilotStreamEventSchema`: adicionar variante `om_status` e campos opcionais `threadId?: string`, `executionMode?: LlmExecutionMode` no evento `done`.

---

## 4. Persistência, Segurança e Decisões Técnicas

1. **Zero Novas Tabelas Drizzle no Slice 18:**
   * A persistência de threads, mensagens e registros de `ObservationalMemory` utiliza o storage dual-mode já provisionado por `getMastraStorageSingleton()` (`LibSQLStore` em `${UZINA_DATA_DIR}/mastra.db` ou `PostgresStore` no schema `"mastra"` via `DATABASE_URL`).
   * **Regra crítica de processo único:** em runtime local (`PGlite` + `LibSQL`), `apps/web` e `@uzina/mastra-runtime` compartilham os singletons em `globalThis`; testes de integração usam `":memory:"` e limpam no `afterAll` com `resetMastraStorageForTests()` e `closeDb()`.
2. **Isolamento Multi-Tenant e Anti-IDOR de Threads:**
   * Toda thread pertence a um `resourceId` canônico que embute obrigatoriamente a organização:
     * Engenharia: `uzina:agency:org:${organizationId}:project:${projectId ?? "global"}`
     * Co-piloto Executivo: `uzina:copilot:org:${organizationId}:project:${projectId ?? "global"}`
   * Antes de ler ou anexar mensagens em qualquer `threadId` informado pelo cliente HTTP, o backend verifica `thread.resourceId === expectedResourceId` (ou prefixo da mesma organização após validar que o `projectId` pertence à organização via `clients.organizationId`). Se divergir, gera erro `403/404` ou ignora e cria nova thread isolada — **nunca** permite acesso cross-tenant.
3. **Cofre AES-256-GCM sem `process.env` e sem Vazamento:**
   * `resolveOrganizationModelConfig()` descriptografa a chave somente no escopo da chamada e devolve `OpenAICompatibleConfig` (ou `url` + `apiKey` para Google/Anthropic/OpenAI/OmniRoute/Ollama).
   * **Atenção ao formato de provedor em `OpenAICompatibleConfig`:** provedores OpenAI-compatible/OmniRoute/Ollama aceitam `OpenAICompatibleConfig` diretamente no `ModelRouterLanguageModel` do `@mastra/core`; para **Google Gemini** (`generativelanguage.googleapis.com/v1beta/openai/`) e **Anthropic** (`api.anthropic.com/v1/`), validaremos contra a implementação real de `ModelRouterLanguageModel` em `@mastra/core/dist/llm` se a rota OpenAI-compatible oficial ou adapter dedicado de V2 é mais confiável, garantindo compatibilidade real com tool calling.
   * `RequestContext` **nunca** armazena chaves de API em texto claro — apenas `organizationId`, `userId`, `role` e `projectId`.
   * `SecretRedactionProcessor` e os hooks `beforeObservation` / `afterObservation` da `ObservationalMemory` aplicam `redactSensitiveText()` para impedir gravação de tokens (`sk-`, `ghp_`, `AIza`, `Bearer`) em histórico ou observações.
4. **Degradação Graciosa Offline (`local_assisted`):**
   * Quando a organização não possui chave configurada (ex.: ambiente recém-instalado, CI sem segredos, MSW), o sistema **não falha**: continua operando em modo `local_assisted` usando os fluxos determinísticos existentes, preservando 100% dos testes dos Slices 0–17.

---

## 5. Plano de Testes (*Spec → Teste* antes do Build)

* **Unitários (`packages/contracts/tests/slice18-agents-memory.test.ts` — *Tests as Data* com `test.each`):**
  * Validação `.strict()` de `AgencyChatRequestSchema`, `CopilotChatRequestSchema`, `AgencyThreadListResponseSchema`, `ObservationalMemoryStatusSchema`, `AgencyStreamEventSchema` e `CopilotStreamEventSchema` (casos válidos e rejeição de campos extras/inválidos).
* **Integração (`packages/mastra-runtime/tests/slice18-real-agents-om.integration.test.ts` — PGlite `:memory:` + `LibSQLStore` `:memory:` + `@mastra/core/test-utils/llm-mock`):**
  1. `resolveOrganizationModelConfig` descriptografa credencial AES-256-GCM por organização sem tocar `process.env` e respeita isolamento entre Org A e Org B;
  2. `createUzinaMemory` com `ObservationalMemory` persiste turnos por `threadId`/`resourceId`, bloqueia leitura cross-tenant (anti-IDOR) e redige segredos via `beforeObservation`/`afterObservation` + `SecretRedactionProcessor`;
  3. Agente especialista real (`createEngineeringSpecialistAgent`) executa tool tipada (`search_qmd_memories` / `read_project_deliverables`) usando `MastraLanguageModelV2Mock` e devolve resposta estruturada;
  4. `streamExecutiveCopilot` em modo `live_llm` (com `modelOverride`) executa `agent.stream()`, invoca `read_workspace_overview`, emite eventos `tool_call`, `tool_result`, `token` e `done`, e rejeita qualquer capability proibida (`fs_write`, `shell_exec`, `git_commit_or_push`, `status_merged_without_decision`);
  5. `streamAgencyChatScoped` emite SSE events (`thread_ready`, `token`, `done`) tanto em modo `live_llm` quanto em fallback `local_assisted` sem provedor configurado.
* **Contract Drift Check (`apps/web/tests/contract-drift.test.ts`):**
  * Validar `GET /api/agency/threads` (MSW vs rota real em PGlite) contra `AgencyThreadListResponseSchema` e garantir 401/403 sem sessão ou cross-tenant.

---

## 6. Critérios de Pronto (DoD)

- [x] `node scripts/check-no-ee.mjs` retorna `exit 0` após adicionar `@mastra/memory@1.41.2`.
- [x] `pnpm verify` verde sem violações de `audit:tests`, zero erros TS/ESLint, build Next.js completo passando.
- [x] `pnpm test:e2e` (Playwright) verde contra build de produção.
- [x] QA Visual (`browser`) em `/app` (Desktop `1440×900` Dark/Light Stone e Mobile `390×844`) + `CopilotDrawer` com `0` erros de console, `0` HTTP `>= 500` e `0` overflow horizontal.
- [x] Revisões independentes aprovadas (`test-critic` PASS, `appsec-auditor` PASS, `egm-codebase-details` PASS; `factory-verifier` auditoria estática de conformidade com execução de gates verificada no workspace).

---

## 7. Revisão EGM Pré-Código (Plan Gate)

* **`egm-implementation-readiness` & `egm-design`:** aprovaram a arquitetura do Slice 18 com atenção para:
  * Resolução dinâmica por tenant via `RequestContext` e descriptografia AES-256-GCM por invocação sem mutar `process.env` e sem vazar segredos em spans ou observações.
  * Normalização exata de URLs por provedor (`OpenAICompatibleConfig` com stripping de `/v1` no Ollama, Google/Anthropic nativos e guardas anti-SSRF em `HttpUrlSchema`, `PATCH /api/providers/[id]` e `llm-client.ts`).
  * Retenção de cauda e `onTailFlushed` no `SecretRedactionProcessor` para impedir vazamento de segredos divididos entre chunks SSE.
  * Separação limpa entre ações transacionais determinísticas (`plan_deliverables`, `run_cycle`) e conversação via `Agent.stream()` + fallback gracioso `local_assisted`.

---

## 8. Evidências Reais Pós-Código (Verify Gate)

* **`node scripts/check-no-ee.mjs`:** `OK [check-no-ee]: Nenhuma dependência ou importação comercial Mastra ee/ encontrada.` (`exit 0`).
* **`node scripts/audit-tests.mjs`:** `[audit:tests] Arquivos: 67 | Testes: 208 | Suprimidos: 2 | Violações: 0` (`exit 0`).
* **`pnpm verify`:** `Tasks: 34 successful, 34 total` (`1m17.721s`), cobrindo `build`, `typecheck`, `lint` e `test` nos 9 pacotes (`@uzina/contracts` `180 passed`, `@uzina/core` `157 passed`, `@uzina/codebase-intel` `13 passed`, `@uzina/security-engine` `19 passed`, `@uzina/cli` `13 passed`, `@uzina/opencode-bridge` `51 passed`, `@uzina/db` `38 passed | 1 skipped` — apenas `postgres-live.test.ts` pulado localmente sem `TEST_DATABASE_URL`, `@uzina/web` `28 passed`, `@uzina/mastra-runtime` `28 passed`; total Vitest: **`527 passed | 1 skipped`**).
* **Build Standalone (`$env:UZINA_STANDALONE="1"; pnpm --filter @uzina/web build`):** compilação Next.js `16.4.6` (Turbopack) concluída com `exit 0`.
* **`pnpm test:e2e` (Playwright):** `2 passed (10.5s)` contra build de produção de `apps/web`.
* **QA Visual (`browser` em `http://localhost:3000/app`):** **PASS** em Desktop `1440×900` (Dark e Light Stone), Mobile `390×844`, hidratação pós-reload, `[data-om-status]`, badge de execução e `CopilotDrawer` (`0` erros de console/hidratação, `0` HTTP `>= 500`, `0` overflow horizontal).
* **Revisores:** `appsec-auditor` (**PASS**), `egm-codebase-details` (**PASS**) e `test-critic` (**PASS** após ajuste final de `slice18-real-agents-om.integration.test.ts` validado no `pnpm verify` acima).
