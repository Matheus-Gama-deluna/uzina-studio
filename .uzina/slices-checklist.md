# Checklist de Implementação — Uzina Studio (Fase 1 MVP · Slices 0–6 | Fase 2 · Slices 7–10)

> **Regra de Ouro:** Não avançar para o Slice N+1 enquanto o Slice N não passar integralmente em `pnpm verify`, tiver seu Dossiê atualizado em `docs/slices/` e for aprovado pelo usuário.
> **Painel de Status:** Consulte `docs/status/ROADMAP_STATUS.md` para a visão executiva consolidada.

- [x] **Fase 0 — Bootstrap, Ambiente & Governança**
  - [x] Ativação do `pnpm` (`12.21.0`) e validação do ambiente local
  - [x] Extração do kit + preservação e mescla de `AGENTS.md` e `.agents/`
  - [x] Adaptação oficial para **Uzina Studio** (`@uzina/*`, CLI `uzina`, `.uzina/`) + ADR-001 e ADR-002
  - [x] Correção do bug de regex em `scripts/check-no-ee.mjs` e validação negativa/positiva
  - [x] Estrutura de controle de fases (`ROADMAP_STATUS.md`, `PROGRESS_LOG.md`, templates e workflow `/execute-slice`)
  - [x] Inicialização Git (`main`) + `.gitignore` robusto
  - [x] Dossiê do Slice 0 (`docs/slices/slice-00-walking-skeleton.md`) revisado via Plan Gate EGM (`readiness` + `design`)

- [x] **Slice 0 — Walking Skeleton** (*Contract-First + Skeleton*)
  - [x] Monorepo `pnpm` + Turborepo + TypeScript strict + `.npmrc` (`save-exact=true`)
  - [x] `@uzina/contracts` base (`HealthCheckSchema`, enums centrais)
  - [x] `@uzina/db` dual-mode (PGlite local single-process `globalThis` + switch `DATABASE_URL` Postgres + `docker-compose.dev.yml`)
  - [x] `apps/web` Next.js App Router + Better Auth + `GET /api/health`
  - [x] `pnpm verify` verde (`check-no-ee`, typecheck, lint, build, testes de integração) + validação visual (`browser`) + `factory-verifier` PASS

- [x] **Slice 1 — Hierarquia, Cofre & UI com MSW** (*Frontend-First + Domain-First*)
  - [x] Seed automático do cliente `"Internos"` e CRUD `Clients → Projects (+ Repos) → Deliverables`
  - [x] Cofre AES-256-GCM + `provider_profiles` (OmniRoute/Direct/Ollama) com testes unitários (encrypt/decrypt/tamper)
  - [x] Telas: Sidebar Hierárquica + Kanban + Lista + Configurações de Provedor (navegáveis com MSW)
  - [x] Contract Drift Check verde contra as rotas reais + QA Visual + `factory-verifier` PASS

- [x] **Slice 2 — OpenCode Bridge, Worktrees & StuckDetector** (*Domain-First + Tests as Data*)
  - [x] `@uzina/opencode-bridge` (`LocalGitWorktreeWorkspace` + `OpenCodeRunner` `plan`/`build` + `role_bindings`)
  - [x] Integração das 8 skills `packages/skills/*/SKILL.md`
  - [x] `StuckDetector` (5 padrões testados via tabela declarativa *Tests as Data*)
  - [x] Teste de integração real criando e limpando worktree em repo temporário

- [x] **Slice 3 — Workflow Mastra, Descoberta & Estúdio Visual Lite** (*Contract-First + Vertical Slice*)
  - [x] `@uzina/mastra-runtime` (LibSQLStore/PostgresStore) + lock atômico SQL
  - [x] `deliverableLifecycleWorkflow` com `suspend()`/`resume()` sobrevivendo a restart
  - [x] Entrevista 2–3 rodadas (5 pilares) + Mapa Brownfield leve + Strategy Router (6 estratégias)
  - [x] Estúdio Visual Lite (Moodboard + uploads em `/api/assets/:id` + `.uzina/DESIGN.md`)
  - [x] Etapa `stage_contract_and_tests` executando antes do `stage_build`

- [x] **Slice 4 — `.uzina/verify`, `security-engine` v1 & Caixa de Decisões** (*Marco Utilizável #1*)
  - [x] Auditor estático de Test Anti-Patterns (`packages/core/src/test-auditor.ts`)
  - [x] `@uzina/security-engine` (Gitleaks, Opengrep/Semgrep, Trivy, OSV-Scanner, Slopsquatting/DDL, SARIF, `skipped_missing_binary`, triagem 3 vereditos)
  - [x] CLI standalone `uzina-sec` (`scan`, `doctor`, `install-tools` — encapsulada em `uzina sec` no Slice 6) + aba Auditoria de Segurança (`/app/security`)
  - [x] Caixa de Decisões HITL (`/app/decisions`) + Pacote de Evidências + `stage_finalize` (branch local / `gh pr create --draft`) — Verify Gate `368 passed | 1 skipped` (`postgres-live.test.ts`), `audit:tests` (`0` violações), `browser` QA **PASS** (`feat/slice-04-verify-security-engine-decisions`)

- [x] **Slice 5 — Co-piloto Executivo & Memória em 3 Escopos** (*Vertical Slice*)
  - [x] Co-piloto Executivo (Mastra `Agent`, read-only + rascunho + trigger scan) no drawer global via SSE
  - [x] Teste comprovando bloqueio de escrita de código e shell no Co-piloto
  - [x] CRUD e injeção automática de `memories` (`org | client | project`) com isolamento comprovado entre clientes — Verify Gate `380 passed | 1 skipped` (`postgres-live.test.ts`), `audit:tests` (`0` violações), `browser` QA **PASS** (`feat/slice-05-copilot-memories`)

- [x] **Slice 6 — Empacotamento, Migração & Release (`npx` + Docker)** (*Marco Fase 1 Completa*)
  - [x] `apps/cli` (`uzina start`, `uzina dev`, `uzina sec`, `uzina db migrate-to-postgres`, `uzina doctor`) + motor idempotente `migrateDatabaseData` em `@uzina/db` (`16` tabelas em ordem topológica)
  - [x] `Dockerfile` multi-stage (com os 4 scanners pré-instalados) + `docker-compose.yml` (`UZINA_STANDALONE=1` validado)
  - [x] GitHub Actions (`ci.yml` + `release.yml` GHCR + npm) + suíte Playwright E2E (`2 passed`) — Verify Gate `400 passed | 1 skipped` (`postgres-live.test.ts`), `audit:tests` (`0` violações) (`feat/slice-06-packaging-release`)


---

## Fase 2 — Codebase Intelligence, Memória QMD & Estúdio Visual (Google Stitch)
> Blueprint: `docs/especificacao-tecnica-fase-2-v1.0.md` · Decisão: `docs/adr/004-codebase-intelligence-qmd-embeddings-stitch.md`
> Cada slice: Plan Gate EGM → Contract-First → TDD → Verify Gate sem cache (`TEST_DATABASE_URL`, `0 skipped`) → QA visual → docs → commit/push/PR.

- [x] **Slice 7 — Motor QMD Híbrido & Embeddings Locais** (`docs/slices/slice-07-qmd-hybrid-memory-local-embeddings.md`)
  - [x] Contratos `qmd.ts` + chunker por headings + RRF + `EmbeddingProvider` (Tests as Data)
  - [x] Tabela `memory_chunks` (FTS + `embedding real[384]`) em PGlite **e** Postgres + migração `0006`
  - [x] Interface `EmbeddingProvider` + fallback determinístico offline (`deterministic-trigram-384`, extensível para ONNX local)
  - [x] `/api/memories/search`, `/api/qmd/reindex`, UI de busca em `/app/memories`, `uzina memory search`
  - [x] Isolamento multi-tenant + redação de segredos comprovados (`421 passed | 0 skipped` + Playwright `2 passed`) (`feat/slice-07-qmd-hybrid-memory`)

- [x] **Slice 8 — Codebase Intelligence (`@uzina/codebase-intel`)** (`docs/slices/slice-08-codebase-intel-ast-graph-provenance.md`)
  - [x] Indexador AST incremental (SHA-256) + esqueleto + Context Tree
  - [x] Tabelas `codebase_*` e `decision_provenance` + hooks `stage_finalize` (`0007_peaceful_grandmaster.sql`)
  - [x] Consultas somente leitura (`/api/projects/[id]/codebase*`) + adaptadores opcionais com degradação `skipped_missing_binary`
  - [x] Redução de tokens ≥ 80% medida em fixture e QA visual em `/app/projects/[id]/code` (`444 passed | 0 skipped`, Playwright `2 passed`) (`feat/slice-08-codebase-intel`)

- [x] **Slice 9 — Estúdio Visual 3 Níveis & Google Stitch** (`docs/slices/slice-09-visual-studio-3levels-google-stitch.md`)
  - [x] `DesignPrototypeAdapter` + sanitizador HTML anti-XSS + extrator de tokens W3C (`@uzina/core/prototypes`)
  - [x] Conector Stitch (MCP stdio `shell: false` + importação HTML/Tailwind com `413` > 2 MiB)
  - [x] Preview sandboxed (`CSP default-src 'none'` + `<iframe sandbox="">`) + aprovação/handoff `.uzina/prototypes/` (`464 passed | 0 skipped`, Playwright `2 passed`) (`feat/slice-09-visual-studio-stitch`)

- [x] **Slice 10 — Docker Workspace & FinOps de Tokens** (`docs/slices/slice-10-docker-workspace-token-finops.md`) ★ **Fase 2 Completa**
  - [x] `DockerExecutionWorkspace` (hardening `--cap-drop ALL`, `--network none`, `--read-only`, `--user 1001:1001`, limpeza `docker rm -f`) com suíte de contrato
  - [x] `token_savings_events` (`0009_pale_hellion.sql`) + `/api/finops/summary` + painel `/app/finops` + `uzina doctor` (`docker` + `workspaceMode`) (`480 passed | 0 skipped`, Playwright `2 passed`) (`feat/slice-10-docker-workspace-finops`)

- [x] **Slice 11 — Configuração Dinâmica de Motores, Embeddings Semânticos & AST Poliglota** (`docs/slices/slice-11-dynamic-engine-config-polyglot-ast-semantic-embeddings.md`)
  - [x] `engine_configs` (`0010_breezy_snowbird.sql`) + `/api/finops/config` (`GET`/`PUT`/`POST`) com hot-reload sem restart de Docker
  - [x] Embeddings semânticos bilíngues PT-BR/EN (`onnx_e5_small`) + fallback `ollama` e `ENGINE_OPTIONS_CATALOG` (Consumo × Benefício)
  - [x] Indexador AST poliglota (`ts_native` vs `polyglot`: `.py`, `.go`, `.rs`, `.sql`, `.java`, `.cs`) + `buildAutoInjectedCodebaseContext` (`prompt_cache`)
  - [x] Painel dinâmico em `/app/finops` + QA visual sem overflow (`487 passed | 0 skipped`, Playwright `2 passed`) (`feat/slice-11-dynamic-engines-polyglot-ast`)

- [x] **Slice 12 — Guia de Prontidão, Central Conversacional de Agentes, Model Tiering & Artefatos Cíclicos** (`docs/slices/slice-12-onboarding-conversational-agency-cyclic-workflows.md`)
  - [x] Guia Interativo de Prontidão (`SystemReadinessStatus`) + Equipe de 6 Agentes com Model Tiering (`Tier 3 Pro` vs `Tier 2 Flash`)
  - [x] Central Conversacional Multi-Agente em `/app` (Fluxo Greenfield do zero + Fluxo Brownfield com URL Git remota, Brownfield Scan e AST Poliglota)
  - [x] Inspetor Duplo de Artefatos (Longo Prazo: PRD, Arquitetura/ADR, AST, `DESIGN.md` vs. Táticos de Slice: `specMarkdown`, `blueprintJson`, `evidencePackJson`) com Aprovação e Retorno Cíclico (`Ciclo #2+`)
  - [x] Motor de Ciclo Autônomo sem pular fases com parada obrigatória em `decision_pending` (`494 passed | 0 skipped`, Playwright `2 passed`) (`feat/slice-12-autonomous-agency-chat-onboarding`)

- [x] **Slice 13 — Redesign Chat-First no Topo, Estratégia Decidida pelo Arquiteto, Equipe Enxuta/Completa & Portão de Prototipação Visual** (`docs/slices/slice-13-chat-first-top-architect-strategy-visual-gate.md`)
  - [x] Chat Amplo na primeira dobra de `/app` (`7/12`) com Setup compacto expansível e composer `<textarea>` multilinha único
  - [x] `decideOptimalAiStrategy`: Arquiteto de Software decide a estratégia ideal para execução por IA sem exigir escolha manual do usuário
  - [x] Topologia de equipe adaptativa (`Equipe Enxuta MVP · 3` vs `Completa · 6 Especialistas`)
  - [x] Aba `Estúdio & Protótipo` integrada ao lado do Chat com preview `<iframe sandbox="">`, geração automática de protótipo inicial e Portão Visual antes da codificação (`495 passed | 0 skipped`, Playwright `2 passed`) (`feat/slice-13-chat-first-architect-strategy-visual-gate`)

- [x] **Slice 14 — Polimento Visual Desktop/Mobile, Fluxo Contínuo & Eliminação de Botões Mortos** (`docs/slices/slice-14-visual-ux-polish-desktop-mobile.md`)
  - [x] Desktop `1440×900` com Chat, Quick-Prompts em 1 linha e botão `Enviar Mensagem` 100% visíveis na primeira dobra (`y + height = 870px`)
  - [x] Mobile `390×844` com Switcher Segmentado (`Chat IA` | `Estúdio` | `Slices`), alvos de toque `>= 40px` e preview `<iframe sandbox="">` responsivo sem scroll horizontal
  - [x] Persistência do histórico do Chat por projeto (`localStorage` + `useSyncExternalStore` sem erro de hidratação SSR), formatação Markdown limpa e estado pós-aprovação visual com avanço direto para `Contratos & TDD`
  - [x] Sincronização bidirecional Kanban ↔ `Slices`, Sidebar `HIERARQUIA (CLIENTES)` clicável, breadcrumbs de `/app/finops` e `/code` corrigidos e redirecionamento em `/app/settings` e `/exec` (`495 passed | 0 skipped`, Playwright `2 passed`) (`feat/slice-14-visual-ux-polish-desktop-mobile`)

- [x] **Slice 15 — Conexão Real Multi-LLM, Ping de Credenciais, Prototipação Dinâmica & Polimento Visual Global (2ª Rodada)** (`docs/slices/slice-15-live-llm-connection-visual-polish-r2.md`)
  - [x] Conector Multi-LLM real (`packages/mastra-runtime/src/llm-client.ts`) com descriptografia AES-256-GCM em memória (`Google Gemini`, `OpenAI / OpenRouter`, `Anthropic Direct`, `Ollama Local`) e endpoint `POST /api/providers/test`
  - [x] Redesign de `/app/providers` com 4 cards rápidos em 1 clique, auto-preenchimento de `Base URL` e dos 7 papéis de agentes, presets (`Tiering Pro + Flash` vs `100% Rápido / Free Tier`) e botão `Testar Conexão Real (Ping LLM)`
  - [x] Protótipos visuais adaptados ao domínio (`inferDomainVisualBlueprint` com abas, KPIs e tabelas do domínio) + badge transparente `🟢 LLM Real Ativo` vs `🟡 Modo Simulado Local` no Chat
  - [x] Eliminação da barra de abas duplicada no Mobile `Estúdio`, botão `← Voltar ao Chat do Projeto` (`min-h-9`) em todas as páginas operacionais, `FinOps` no `⌘K` e pré-seleção do projeto ativo no `Co-piloto Executivo` (`495 passed | 0 skipped`, Playwright `2 passed`) (`feat/slice-15-live-llm-connection-visual-polish-r2`)

- [x] **Slice 16 — Redesign Visual Calmo (90/10), Tipografia Confortável (`A- | A | A+`) & Arquitetura em 4 Momentos Dedicados** (`docs/slices/slice-16-calm-ui-typography-four-moments.md`)
  - [x] Disciplina cromática **90/10** (`Calm Precision Dark/Light`), corpo `14px–15px`, controle global `A- | A | A+` (`data-font-scale`) sem erro de hidratação e sidebar retrátil (`CockpitShell` + `active-project-store.ts`)
  - [x] Divisão da Torre de Controle em 4 momentos dedicados: `/app/ideas` (`IdeasHub` estilo Lovable/v0), `/app` (`AgencyCommandCenter` centralizado `max-w-4xl`), `/app/studio` (`VisualStudioWorkspace` com switcher `Desktop | Tablet 640px | Celular 390px` e aba `Referências, Stitch & Workflow`) e `/app/deliverables` (`DeliverablesDocsHub` com abas `Entregas & Slices` e `Documentos`)
  - [x] Verificado com `check-no-ee` (exit `0`), `audit-tests` (`0` violações), `typecheck`, `lint`, `contract-drift.test.ts` (`1 passed`), `build`, Playwright E2E (`2 passed`) e QA visual no `browser` Desktop/Mobile (`feat/slice-16-calm-ui-typography-four-moments`)

- [x] **Slice 17 — Sistema Visual Warm Stone (4 Degraus), `Project Switcher` na Sidebar & Coesão Global** (`docs/slices/slice-17-stone-ui-sidebar-switcher-cohesion.md`)
  - [x] Escala tonal **Warm Stone (`hue 65–75`) em 4 degraus** (Dark e Light) + `.uzina-card` em `globals.css` e `.uzina/DESIGN.md`, preservando laranja âmbar cirúrgico (`1 CTA/tela`)
  - [x] Nova sidebar com `Project Switcher` no topo (`sidebar-project-switcher`), trilha de 5 etapas em `Projeto Ativo` e grupo recolhível `Fábrica & Sistema`; `Co-piloto` reposicionado como atalho discreto no header e `⌘K`
  - [x] Correção do scroll duplo no Chat em `1440×900` (Dark e Light, `y+h = 867.2px <= 900`), remoção de `<select>`/`← Chat` redundantes e unificação visual + tipográfica (`>= 12px`) das 5 páginas operacionais (`/app/memories` modal sob demanda sem UUIDs crus, `/app/providers` cards Stone, `/app/finops` medição manual recolhível, `/app/decisions`, `/app/security`) (`feat/slice-17-stone-ui-sidebar-switcher-cohesion`)

---

## Fase 3 — Cérebro Agêntico Real, Observational Memory & Evolução Mastra

- [x] **Slice 18 — Cérebro Agêntico Real, Observational Memory & Guardrails Processors** (`docs/slices/slice-18-real-agents-observational-memory-processors.md`)
  - [x] Ponte multi-tenant segura do Cofre AES-256-GCM para o Mastra (`model-resolver.ts`) sem mutar `process.env`, com guarda anti-SSRF pré-decriptografia (`errors.ts`, `PATCH /api/providers/[id]`, `llm-client.ts`)
  - [x] Memória episódica/sessão (`@mastra/memory@1.41.2` + `ObservationalMemory` com isolamento `resourceId` e hooks redatores) + tools institucionais tipadas (`workspace-tools.ts`: QMD, AST e entregas com RBAC)
  - [x] Guardrails processors (`processors.ts`: `SecretRedactionProcessor` com holdback + `onTailFlushed`, `ToolSearchProcessor`, `TokenLimiterProcessor`, `defaultStabilityErrorProcessors`)
  - [x] Execução real via `Agent.stream()` no Co-piloto Executivo (`executive-copilot.ts`) e Central da Agência (`agency.ts`), rotas `GET /api/agency/threads` e `POST /api/agency/chat/stream`, MSW/contract-drift e UI SSE (`AgencyCommandCenter` + `CopilotDrawer` com badge `LLM Real` vs `Assistido Local` e `data-om-status`)
  - [x] Verify Gate pós-auditoria verde: `check-no-ee` (`0`), `audit:tests` (`67` arquivos, `208` testes, `0` violações), `pnpm verify` (`34/34` tasks, `527 passed | 1 skipped` `postgres-live.test.ts`), `UZINA_STANDALONE=1` build (`0`), Playwright `test:e2e` (`2 passed`), QA visual (`browser` **PASS**) e revisores (`appsec-auditor`, `egm-codebase-details`, `test-critic` **PASS**) (`feat/slice-18-real-agents-observational-memory-processors`)

- [x] **Slice 19 — Ponte Real Chat ↔ Workflow Durável, `AgentController` & Kanban `Manual | Auto`** (`docs/slices/slice-19-agent-controller-workflow-bridge-kanban-auto.md`)
  - [x] Contratos e migração `0011_flimsy_menace.sql` (`ProjectStageAutomationSchema` com trava `decision_pending: "manual"`, `budgetCapUsd` `numeric(12,6)`, `CodingExecutorModeSchema`, `BackgroundTaskSummarySchema`, `WorkflowAbortResponseSchema`, eventos SSE e rotas de sessão/abort/background-tasks)
  - [x] `UzinaAgentController` (`controller.ts`) com 5 modos literais, `steer()`, `abort()`, `resolveSessionPlanScoped()`, `BackgroundTasksRegistry` (`background-tasks.ts`) e contenção de filesystem + `AgentsMDInjector` + `SkillsProcessor` (`processors.ts`, `workspace-adapter.ts`)
  - [x] Ponte real `advance_cycle` → `deliverableLifecycleWorkflow` (`agency.ts`), `MastraWorkspaceExecutorAdapter` (`codingExecutorMode`), automação por coluna `Manual | Auto`, trava HITL em `decision_pending` e pausa inteligente `budget_cap_pause` com retomada `newBudgetCapUsd`
  - [x] Controles Warm Stone na UI (switches `role="switch"` no Kanban, `Teto Orçamento (USD)`, badge `Tarefas em 2º plano`, `Intervir (Steer)` / `Abortar` / `Aprovar Plano` no Chat, `budget_cap_pause` em Decisões e `Executor de Codificação` em FinOps), MSW + Contract Drift + RBAC completos
  - [x] Gate final pós-remediações verde: `check-no-ee` (`0`), `audit:tests` (`70` arquivos, `224` testes, `0` violações), `pnpm verify` (`34/34` tasks, `558 passed | 1 skipped` `postgres-live.test.ts`), `UZINA_STANDALONE=1` + build padrão (`0`), Playwright `test:e2e` (`2 passed`) e QA visual (`browser` **PASS** em Dark/Light Stone e Mobile) (`feat/slice-19-agent-controller-workflow-bridge-kanban-auto`)


- [x] **Slices 20–25 — Plano Mestre P0–P3** (`docs/planos/plano-mestre-p0-p3-slices-20-25.md`)
  - [x] Finalize Git real, Switcher sincronizado, Estúdio Visual LLM, QMD isolado, Mobile `390px`/A11y, Tool Trace SSE resumível, Semantic Diff, Worktrees GC, AST Symbol Lock, Docker Hot-Reload, Tool Policies (`Allow`/`Ask`/`Deny`) e GitHub PAT Draft PR (`main`)

- [x] **Slice 26 — Controller Dinâmico, SkillsLoader v2 (`agentskills.io`), Playbooks Sênior & Guardrails** (`docs/slices/slice-26-controller-model-resolver-skills-loader-v2.md`)
  - [x] Remoção de `"openai/gpt-4o-mini"` hardcoded em `controller.ts` (`resolveControllerModelForMode` + `dynamicControllerModel` + `getControllerBackingAgent()` + validação IDOR)
  - [x] `skills-loader.ts` v2 (`references/`, `templates/`, `scripts/`, budgets `64`/`1024`/`500`, `loadSkillResource` seguro, `selectNonConflictingSkillsForStage`)
  - [x] Playbooks Sênior (`getRolePlaybookInstructions`) + `createUzinaSkillsCatalogProcessor` + tool `load_uzina_skill`
  - [x] `WorkingMemory` tipada (`AgencyWorkingMemorySchema`) + `SemanticRecall` QMD multi-tenant + `PromptInjectionGuardProcessor` (`NFKC`/zero-width, `processInput`, `processInputStep`, `processToolResult` preservando redação)
  - [x] Verify Gate verde: `check-no-ee` (`0`), `audit-tests` (`84` arquivos, `275` testes, `0` violações), `pnpm verify` (`34/34` tasks), `test-critic`, `appsec-auditor` e `factory-verifier` (**PASS**) (`fix/slice-26-controller-model-resolver-skills-loader-v2`)
