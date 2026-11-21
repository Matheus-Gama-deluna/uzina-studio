# Especificação Técnica de Implementação — Fábrica de Software com IA (Fase 1 MVP)

**Versão:** 1.1 (Auditada e Pronta para Agente Codificador — Derivada da [Especificação de Produto v2.10](./especificacao-produto-arquitetura-v2.10.md))  
**Objetivo:** Blueprint técnico executável por agentes de código e engenheiros humanos para construir a **Fase 1 (MVP Utilizável)** de forma incremental, aplicando no desenvolvimento do próprio sistema as estratégias arquiteturais definidas na especificação.  
**Stack Travada (100% Open-Source / Zero Vendor Lock-In):** Node.js 22 LTS, `pnpm` (`--frozen-lockfile`), Turborepo, TypeScript strict, Next.js App Router, Better Auth, Drizzle ORM (`pg-core`), [PGlite](https://chat2db.ai/resources/blog/pglite-vs-sqlite) / PostgreSQL + `pgvector`, [Mastra Core](https://mastra.ai/docs/storage) (Apache 2.0 estrito — proibição absoluta de módulos `ee/`), [OpenCode](https://github.com/anomalyco/opencode) (MIT TypeScript SDK), [OmniRoute](https://github.com/cheaper-inference/OmniRoute) (gateway OpenAI-compatible), Vitest, Playwright e [Mock Service Worker (MSW)](https://solospace.net/products/mock-service-worker).

---

## 1. Estratégia de Construção do Próprio Sistema (Dogfooding)

Para acelerar a codificação por agentes e reduzir retrabalho, a construção da Fase 1 aplica nossas próprias estratégias de engenharia (Seções 5.14 e 5.15 da especificação-mestre) desde o primeiro commit:

1. **Contract-First (`packages/contracts` como fonte única de verdade):** Todos os schemas Zod, contratos REST/SSE, payloads de eventos do Mastra, enums de estado e estruturas SARIF são definidos antes de qualquer rota ou tela. O frontend e o backend importam exatamente os mesmos tipos.
2. **Walking Skeleton + Vertical Slices:** Em vez de construir camadas horizontais gigantes que só se integram no final, a Fase 1 é dividida em **7 Vertical Slices incrementais (Slice 0 a Slice 6)** ([InfoQ — Skeleton Architecture](https://www.infoq.com/articles/skeleton-architecture/); [Managed Code — Vertical Slice](https://managed-code.com/blog-post/vertical-slice-architecture-for-ai-generated-code)). Cada Slice entrega banco + domínio + API + UI + testes ponta a ponta funcionando.
3. **Frontend-First + MSW no Painel (`apps/web`):** As telas do Painel (Kanban, Caixa de Decisões, Drawer Co-piloto, Onboarding, Estúdio Visual Lite e Auditoria de Segurança) são construídas em paralelo usando handlers [MSW](https://solospace.net/products/mock-service-worker) derivados de `packages/contracts`, trocando para a API real apenas desativando o interceptador.
4. **Domain-First + Tests as Data no Core (`packages/core`):** Máquina de estados de entregas, Strategy Router, `StuckDetector`, cofre AES-256-GCM e regras de auditoria/poda de testes são implementados sem dependência de banco ou LLM, validados por tabelas declarativas ([Tests as Data — Martin Fowler](https://martinfowler.com/articles/tests-as-data.html)).
5. **Isolamento Spec → Teste + Posse de Arquivos:** Para cada Slice, os testes de aceitação são escritos antes da implementação com base nos contratos. Cada agente trabalha em um único pacote/slice por worktree para evitar conflitos de merge e *context rot*.

---

## 2. Corte Oficial de Fases (Incremental e Utilizável desde a Fase 1)

A Fase 1 foi desenhada para ser **100% utilizável em produção pessoal ou em software house desde o primeiro release** (rodando local zero-config via `npx` ou em VPS via Docker + `DATABASE_URL`), permitindo inclusive usar a própria fábrica da Fase 1 para ajudar a codificar a Fase 2.

| Domínio | Fase 1 — MVP Utilizável (Alvo desta Spec) | Fase 2 — VPS & Qualidade Profunda | Fase 3 — Escala & Software House |
| :--- | :--- | :--- | :--- |
| **Hierarquia & Auth** | `Org → Cliente (seed "Internos") → Projeto (+ 1..N Repos) → Entrega`, Better Auth local/email-senha, Memória 3 escopos (texto/SQL). | Busca vetorial `pgvector` + `@mastra/fastembed`, papéis de time. | SSO/SAML, RBAC granular multi-equipe, Portal externo `/exec`. |
| **Persistência & Deploy** | Zero-config PC (PGlite + LibSQLStore) → 1 linha `DATABASE_URL` (PostgreSQL), `factory db migrate-to-postgres`, releases `npx` + Docker Compose GHCR. | Backups automatizados, filas persistentes multi-worker. | Alta disponibilidade e clusters multi-nó. |
| **Descoberta, Spec & Visual** | Entrevista 2–3 rodadas (5 pilares), mapa brownfield leve (árvore + manifestos + scorecard inicial), Strategy Router (6 estratégias + Single Agent/Lanes), Estúdio Visual Lite (Moodboard com tags de intenção + upload/URL + `.factory/DESIGN.md`). | Mapa AST SQLite (`codebase-memory`), Dembrandt completo, Penpot/Figma MCP, prototipagem 3 níveis completa (imagem + HTML). | Biblioteca compartilhada de Design Systems por cliente. |
| **Execução & Orquestração** | Mastra Core workflows duráveis (`suspend`/`resume`), OpenCode SDK (`plan`/`build`), Git Worktrees locais, posse de arquivos, `StuckDetector` (5 padrões), OmniRoute + Cofre AES-256-GCM + roteamento fixo por papel (Prompt Cache). | Sandboxes Docker/Daytona (`ExecutionWorkspace`), Best of N, Verifier ortogonal multi-rodada. | Blind-Vote Council of Models multi-provider, calibração Golden Dataset (85–90%). |
| **Qualidade de Testes (`.factory/verify`)** | Isolamento Spec → Teste, 8 skills nativas `SKILL.md` (incl. `test-quality-engineering`), Auditor estático de Test Anti-Patterns, Poda de testes redundantes, Contract Drift Check, integração PGlite/MSW. | Mutation Testing incremental no diff (Stryker/mutmut), PBT (`fast-check`/`Schemathesis`), Mutação Semântica (Meta ACH), Holdout Scenarios + Digital Twin Lite. | Benchmarks contínuos de taxa de retrabalho e regressão histórica. |
| **Segurança (`packages/security-engine`)** | Módulo dual-mode (embutido + CLI `factory sec scan` + aba no Painel) com [Gitleaks](https://github.com/gitleaks/gitleaks), [Opengrep](https://github.com/opengrep/opengrep)/[Semgrep](https://github.com/semgrep/semgrep), [Trivy](https://github.com/aquasecurity/trivy), [OSV-Scanner](https://github.com/google/osv-scanner), Slopsquatting/DDL e triagem IA (3 vereditos) com saída SARIF. | [TruffleHog](https://github.com/trufflesecurity/trufflehog), [Checkov](https://github.com/bridgecrewio/checkov), DAST em staging ([Nuclei](https://github.com/projectdiscovery/nuclei) + [OWASP ZAP](https://github.com/zaproxy/zaproxy)), auditoria de lógica com teste PoV, [Promptfoo](https://github.com/promptfoo/promptfoo)/[NVIDIA Garak](https://github.com/NVIDIA/garak), memória de triagem. | Integração opcional com [DefectDojo](https://github.com/DefectDojo/django-DefectDojo) e relatórios executivos de compliance. |
| **Interface & Co-piloto** | Torre de Controle, Caixa de Decisões HITL + Pacote de Evidências, Kanban + Lista, Drawer do **Co-piloto Executivo** (Mastra `.network()`, sem escrita de código/shell) desde o Dia 1. | Visões Timeline, Momento e Entregas, Mapa Mental anti-dívida cognitiva, FinOps Rework Rate, notificações Slack/Telegram/Email. | Portal white-label para clientes e billing por entrega. |

---

## 3. Estrutura do Monorepo e Regras de Fronteira

O repositório usa `pnpm` workspaces + Turborepo com pinagem estrita de versões (`save-exact=true` no `.npmrc` e `--frozen-lockfile` no CI).

```text
├── apps/
│   ├── web/                     # Painel Next.js App Router (UI, Better Auth, API/SSE, Drawer Co-piloto, MSW em src/mocks/)
│   └── cli/                     # Binário npx (factory start, factory dev, factory sec scan, factory db migrate-to-postgres)
├── packages/
│   ├── contracts/               # Fonte única de verdade (Zod, enums, DTOs, REST/SSE, SARIF) — ZERO dependências internas
│   ├── db/                      # Schema Drizzle (pg-core), dual-mode PGlite/Postgres, migrações — importa apenas contracts
│   ├── core/                    # Domínio puro (StateMachine, StrategyRouter, StuckDetector, Vault AES-256-GCM, TestAuditor) — importa apenas contracts
│   ├── opencode-bridge/         # SDK OpenCode (plan/build), LocalGitWorktreeWorkspace, StructuredOutput — importa contracts, core
│   ├── security-engine/         # AppSec Engine dual-mode (Gitleaks, Opengrep/Semgrep, Trivy, OSV-Scanner, SARIF, 3-verdict triage) — importa contracts, core
│   ├── mastra-runtime/          # Mastra Core (Apache 2.0), Co-piloto .network(), workflows suspend/resume — importa contracts, db, core, opencode-bridge, security-engine
│   ├── skills/                  # 8 skills nativas SKILL.md injetáveis no OpenCode
│   └── ui/                      # Componentes compartilhados (Tailwind + Radix/shadcn)
├── scripts/
│   └── check-no-ee.mjs          # CI Blocker anti-@mastra/*-ee e imports ee/
└── .factory/                    # steering.md, DESIGN.md, verify.ts, slices-checklist.md
```

**Regra de Governança de Dependências (CI Blocker):** Qualquer pacote `@mastra/*` com sufixo comercial ou importação de caminhos `ee/` falha o build automaticamente via `scripts/check-no-ee.mjs`.

---

## 4. Persistência Dual-Mode e Schema Drizzle Completo (`packages/db`)

### 4.1 Estratégia Dual-Mode (Zero-Config PC → 1 Linha VPS)

- **Modo Local (sem `DATABASE_URL`):**
  - `packages/db` inicializa `@electric-sql/pglite` persistido em `./data/pgdata` (single-process, queries serializadas, mesmo dialeto SQL PostgreSQL via `drizzle-orm/pglite`).
  - **Restrição Crítica de Processo Único no Modo Local (`PGlite`):** como o PGlite opera em modo *single-connection*, no modo local (`!DATABASE_URL`) o Painel Next.js e o Mastra Runtime executam **no mesmo processo Node.js** via singleton `globalThis` (nunca abrir `./data/pgdata` simultaneamente a partir de um segundo processo worker). A CLI standalone `factory sec scan` roda de forma *stateless* (saída em terminal/arquivo SARIF) ou envia resultados via HTTP para `/api/security/scans` quando o servidor local estiver ativo.
  - `packages/mastra-runtime` inicializa `LibSQLStore` (`file:./data/mastra.db`) para os domínios internos do Mastra (`workflows`, `memory`, `observability`, `threadState`, conforme [Mastra Storage Docs](https://mastra.ai/docs/storage)).
- **Modo VPS / Produção (com `DATABASE_URL=postgres://...`):**
  - `packages/db` alterna automaticamente para `node-postgres` (`drizzle-orm/node-postgres`).
  - `packages/mastra-runtime` alterna automaticamente para `PostgresStore` (`@mastra/pg`) apontando para o mesmo servidor PostgreSQL (schema isolado `mastra`).
- **Migração `factory db migrate-to-postgres`:** CLI idempotente que aplica migrações Drizzle no PostgreSQL de destino, lê todas as tabelas do PGlite local + snapshots do LibSQL em ordem topológica de chaves estrangeiras e insere em transação única validando contagem de registros por tabela.

### 4.2 Entidades Drizzle (`pg-core`) da Fase 1

Todas as tabelas usam `uuid` como PK e timestamps `created_at` / `updated_at` com timezone:

1. **`organizations`**: `id`, `name`, `slug` (unique), `created_at`.
2. **`users` / `sessions` / `accounts`**: Tabelas padrão gerenciadas pelo Better Auth vinculadas a `organization_id`.
3. **`clients`**: `id`, `organization_id` (FK), `name`, `slug`, `is_default_internal` (boolean — seed cria automaticamente o cliente `"Internos"`), `notes`, `created_at`.
4. **`projects`**: `id`, `client_id` (FK), `name`, `slug`, `description`, `default_development_strategy` (enum: `frontend_first_msw | api_contract_first | domain_first | data_schema_first | characterization_strangler | spike_first`), `maturity_score` (integer 0–100, nullable), `design_md_path` (text, nullable), `status` (`active | archived`).
5. **`project_repositories`**: `id`, `project_id` (FK), `name`, `local_path` (text), `remote_url` (text, nullable), `default_branch` (text, default `'main'`), `stack_metadata_json` (jsonb).
6. **`deliverables`**: `id`, `project_id` (FK), `repository_id` (FK), `title`, `description`, `status` (enum: `discovery | spec_review | visual_studio | contract_tests | building | verifying | decision_pending | approved | merged | failed | paused`), `has_ui` (boolean, default `false`), `development_strategy` (enum sobrescrevível), `tactical_pattern` (enum: `single_agent | split_lanes | best_of_n | council`), `risk_level` (enum: `low | medium | high`), `worktree_path` (text, nullable), `branch_name` (text, nullable), `mastra_run_id` (text, nullable), `locked_by` (text, nullable), `locked_at` (timestamp, nullable), `verify_attempts` (integer, default `0`), `max_verify_attempts` (integer, default `3`), `spec_markdown` (text, nullable), `blueprint_json` (jsonb), `evidence_pack_json` (jsonb), `created_at`, `updated_at`.
7. **`provider_profiles`**: `id`, `organization_id` (FK), `name`, `provider_type` (enum: `omniroute | openai_compatible | anthropic | google | ollama`), `base_url` (text), `encrypted_api_key` (text — AES-256-GCM com IV + authTag derivados de `MASTER_ENCRYPTION_KEY`), `role_bindings_json` (jsonb — mapeia modelo fixo por papel: `discovery`, `architect`, `visual`, `builder`, `verifier`, `security`, `copilot`), `is_default` (boolean).
8. **`memories`**: `id`, `organization_id` (FK), `scope_type` (enum: `org | client | project`), `scope_id` (uuid), `category` (enum: `architecture | convention | preference | security_triage | domain_rule`), `title`, `content` (text), `source_deliverable_id` (uuid, nullable), `updated_at`. Índice composto `(scope_type, scope_id, category)`.
9. **`design_assets`**: `id`, `project_id` (FK), `deliverable_id` (uuid, nullable), `asset_type` (enum: `moodboard_image | reference_url | image_mockup | html_prototype | design_md`), `title`, `source_url` (text, nullable), `storage_path` (text, nullable), `intention_tags` (`text[]`), `notes` (text), `approved` (boolean, default `false`).
10. **`decisions`** (Caixa de Decisões HITL): `id`, `deliverable_id` (FK), `mastra_step_id` (text), `decision_type` (enum: `discovery_confirm | blueprint_approve | visual_approve | pr_evidence_approve | stuck_intervention`), `summary` (text), `payload_json` (jsonb), `status` (enum: `pending | approved | changes_requested | rejected`), `human_feedback` (text, nullable), `resolved_by` (uuid, nullable), `resolved_at` (timestamp, nullable).
11. **`security_scans`**: `id`, `organization_id` (FK), `project_id` (uuid, nullable), `deliverable_id` (uuid, nullable), `mode` (enum: `embedded | standalone`), `target_type` (enum: `git_repo | git_diff | container | staging_url`), `target_ref` (text), `scanners_run` (`text[]`), `sarif_raw_json` (jsonb), `summary_counts_json` (jsonb), `status` (enum: `running | completed | failed`), `created_at`.
12. **`security_findings`**: `id`, `scan_id` (FK), `project_id` (uuid, nullable), `rule_id` (text), `scanner` (text), `severity` (enum: `critical | high | medium | low | info`), `file_path` (text, nullable), `line_start` (integer, nullable), `title` (text), `description` (text), `fingerprint` (text — SHA-256 estável), `triage_verdict` (enum: `pending | confirmed | false_positive | unknown`), `triage_rationale` (text, nullable), `suppressed_in_memory` (boolean, default `false`), `pov_test_status` (enum: `not_applicable | missing | failing_confirmed | passing_fixed`).
13. **`execution_events`**: `id`, `deliverable_id` (FK), `stage` (text), `actor_role` (text), `event_type` (enum: `stage_change | tool_call | stuck_alert | verify_result | token_usage | error`), `tokens_input` (integer), `tokens_output` (integer), `cache_read_tokens` (integer), `estimated_cost_usd` (numeric), `payload_json` (jsonb), `created_at`.

### 4.3 Variáveis de Ambiente, Bootstrap de Segredos e Armazenamento de Arquivos Locais

| Variável | Obrigatória / Opções | Comportamento & Valor Default |
| :--- | :--- | :--- |
| `DATABASE_URL` | Opcional | Ausente ativa PGlite + LibSQL local; `postgres://...` ativa PostgreSQL + `PostgresStore`. |
| `FACTORY_DATA_DIR` | Opcional | Default: `./data`. Diretório raiz onde residem `pgdata/`, `mastra.db`, `uploads/` e `.master-key`. |
| `MASTER_ENCRYPTION_KEY` | Opcional no PC / Obrigatória em Prod | No PC local, `factory start` gera chave aleatória de 32 bytes em `${FACTORY_DATA_DIR}/.master-key` (`0600`). Obrigatória via env em produção/Docker. |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | Opcional no PC / Obrigatória em Prod | Gerado automaticamente no modo PC local se ausente; obrigatório em produção VPS. |
| `OMNIROUTE_BASE_URL` / `OMNIROUTE_API_KEY` | Opcional | Bootstrap automático do perfil de provedor padrão no cofre AES-256-GCM. |

**Armazenamento de Uploads (Moodboard / Evidências):** salvos em `${FACTORY_DATA_DIR}/uploads/<project_id>/<uuid>.<ext>` e servidos exclusivamente via rota autenticada `GET /api/assets/:id` (nunca expostos em `apps/web/public/`).

---

## 5. Contratos Compartilhados (`packages/contracts`) e API REST / SSE

### 5.1 Endpoints Principais da Fase 1

| Rota / Canal | Método | Contrato Zod (`packages/contracts`) | Responsabilidade |
| :--- | :--- | :--- | :--- |
| `/api/clients` e `/api/projects` | `GET / POST / PATCH` | `CreateClientSchema`, `CreateProjectSchema` | Gestão da hierarquia `Org → Cliente → Projeto (+ Repos)`. |
| `/api/projects/:id/deliverables` | `GET / POST` | `CreateDeliverableSchema` | Cria entrega e inicia o workflow durável no Mastra. |
| `/api/deliverables/:id/events` | `GET (SSE)` | `ExecutionEventSchema` | Streaming em tempo real de progresso, estágios, `StuckDetector` e tokens. |
| `/api/decisions` e `/api/decisions/:id/resolve` | `GET / POST` | `ResolveDecisionSchema` | Lista pendências HITL e aciona `mastra.resume()` com `approved | changes_requested | rejected`. |
| `/api/providers` | `GET / POST / PATCH` | `UpsertProviderProfileSchema` | Cadastro de OmniRoute/Direct/Ollama com criptografia AES-256-GCM (nunca retorna a chave em texto claro). |
| `/api/projects/:id/design-assets` | `GET / POST / PATCH` | `DesignAssetSchema` | Upload/URL de referências do Moodboard, tags de intenção e aprovação do `.factory/DESIGN.md`. |
| `/api/security/scans` e `/api/security/scans/:id` | `POST / GET` | `RunSecurityScanSchema`, `SecurityScanResultSchema` | Execução sob demanda (standalone) ou leitura de scans embutidos + triagem. |
| `/api/copilot/chat` | `POST (SSE — AI SDK UI)` | `CopilotChatRequestSchema` | Streaming do Co-piloto Executivo ([Mastra AI SDK UI](https://mastra.ai/integrations/agentic-ui/ai-sdk-ui)). |
| `/api/health` | `GET` | `HealthCheckSchema` | Valida conectividade do banco (PGlite ou Postgres), Mastra Store e gateway LLM. |

### 5.2 Regra de Contract Drift Check
Todos os handlers MSW de `apps/web/src/mocks/` validam respostas contra os schemas Zod de `packages/contracts`. Em `apps/web/tests/contract-drift.test.ts`, cada rota real é validada contra o mesmo schema Zod usado pelos mocks, bloqueando o CI caso haja divergência.

---

## 6. Bridge Mastra Core ↔ OpenCode e Workflows Duráveis

### 6.1 Interface `ExecutionWorkspace` e `OpenCodeRunner` (`packages/opencode-bridge`)

- `ExecutionWorkspace`: `prepare(repoPath, baseBranch, deliverableId) -> { workspacePath, branchName }`, `exec(cmd, opts) -> { exitCode, stdout, stderr, durationMs }`, `getDiff(baseRef) -> string`, `cleanup() -> void`. Implementação Fase 1: `LocalGitWorktreeWorkspace` (`git worktree add -b factory/<slug> <dir>`).
- `OpenCodeRunner`: `runSession({ workspacePath, mode: 'plan' | 'build', role, providerConfig, prompt, skills, outputSchema?, maxSteps, signal }) -> OpenCodeSessionResult`.
  - **Higiene de Prompt Cache:** `providerConfig` resolve o modelo fixo vinculado ao `role` antes do início da sessão e **nunca troca de modelo no meio de uma sessão ativa**.
  - **Modo `plan`:** estritamente *read-only* (Descoberta, Brownfield, Arquitetura, Verifier).
  - **Modo `build`:** escrita permitida apenas dentro do worktree da entrega.

### 6.2 Workflow Durável Mastra (`deliverableLifecycleWorkflow`)

Implementado em `packages/mastra-runtime/src/workflows/deliverable-lifecycle.ts` usando exclusivamente APIs Apache 2.0 do [Mastra Workflows](https://mastra.ai/docs/workflows/overview):

1. **Checkout Atômico SQL:** `UPDATE deliverables SET locked_by = $worker, locked_at = NOW() WHERE id = $id AND (locked_by IS NULL OR locked_at < NOW() - INTERVAL '5 minutes')`.
2. **Estágios com `suspend()` / `resume()`:**
   1. `stage_discovery` → perguntas (máx. 2–3 rodadas nos 5 pilares) → `suspend('discovery_confirm')`.
   2. `stage_blueprint` → *Strategy Router* (6 estratégias + padrão tático + fatias verticais) → `suspend('blueprint_approve')`.
   3. `stage_visual_studio` (condicional se `has_ui === true`) → Moodboard/referências + `.factory/DESIGN.md` → `suspend('visual_approve')`.
   4. `stage_contract_and_tests` → OpenCode `build` gera **apenas** contratos (OpenAPI/Zod/Schema), *Tests as Data* e testes de aceitação derivados da Spec (antes de código de produção).
   5. `stage_build` → OpenCode `build` implementa o código produtivo no worktree sob supervisão do `StuckDetector`.
   6. `stage_verify` → `.factory/verify` determinístico + `packages/security-engine` no diff + Verifier independente (`plan` sem CoT do Builder, máx. 3 ciclos).
   7. `stage_decision` → monta `EvidencePack` → cria registro em `decisions` → `suspend('pr_evidence_approve')`.
   8. `stage_finalize` → commit/PR ou merge local, grava aprendizados em `memories` e limpa o worktree.

**Matriz de Transições Válidas (`packages/core/src/state-machine.ts`):**
- `discovery → spec_review` (após `discovery_confirm`)
- `spec_review → visual_studio` (se `has_ui === true`) ou `contract_tests` (se `has_ui === false`)
- `visual_studio → contract_tests` (após `visual_approve`)
- `contract_tests → building → verifying → decision_pending`
- Em `decision_pending`: `approved → approved → merged`; `changes_requested → building` (injetando `human_feedback` e reiniciando `verify_attempts = 0`); `rejected → failed` (limpando worktree com `git worktree remove --force`).
- Qualquer estágio em execução pode ir para `paused` (via `StuckDetector` ou pausa manual) e retomar para o estágio anterior após resolução humana.

**Finalização Git na Fase 1 (`stage_finalize`):** cria commit padronizado na branch `factory/<slug>` no worktree; se o CLI `gh` estiver autenticado e houver `remote_url`, abre Draft PR via `gh pr create`; caso contrário, oferece merge local seguro na `default_branch`.

### 6.3 `StuckDetector` Determinístico (`packages/core/src/stuck-detector.ts`)

Baseado nos 5 padrões do [OpenHands StuckDetector](https://docs.openhands.dev/sdk/guides/agent-stuck-detector), suspende (`decision_type: 'stuck_intervention'`) quando detectar:
1. 4+ repetições idênticas de ação + observação;
2. 3+ repetições da mesma ação retornando erro;
3. 3+ turnos consecutivos de monólogo sem chamada de ferramenta;
4. 6+ oscilações alternadas (ping-pong A→B→A→B);
5. 2+ erros consecutivos de estouro de janela de contexto.

### 6.4 Co-piloto Executivo (Mastra `.network()` — Dia 1)

Registrado em `packages/mastra-runtime/src/agents/executive-copilot.ts` no drawer global:
- **Permitido:** leitura de `clients`, `projects`, `deliverables`, `decisions`, `security_scans`, `memories`; criação de rascunho de entrega; resumo executivo e disparo de scan de segurança.
- **Restrições duras no código:** zero escrita em disco, zero shell/git, zero alteração direta de status `merged` sem decisão humana.

---

## 7. Pipeline `.factory/verify` e Módulo Autônomo `packages/security-engine`

### 7.1 Contrato do `.factory/verify` (Fase 1)
1. `typecheck` (`tsc --noEmit`) + `lint` + `build`;
2. **Auditor Estático de Test Anti-Patterns** (`packages/core/src/test-auditor.ts`): rejeita testes sem `expect`/`assert`, asserções triviais isoladas (`toBeTruthy()`, `toBeDefined()`), `try/catch` engolindo falha, `setTimeout`/`sleep` em teste unitário e 3+ blocos duplicados fora de `test.each`;
3. **Testes de Unidade, Domínio (*Tests as Data*) e Integração Real** (Vitest contra PGlite em memória e MSW na borda de rede) + **Contract Drift Check**;
4. **Gate de Segurança Incremental** (`packages/security-engine` no diff da branch).

### 7.2 Arquitetura do Pacote Standalone `packages/security-engine`
- **Adaptadores (Fase 1):** [Gitleaks](https://github.com/gitleaks/gitleaks), [Opengrep](https://github.com/opengrep/opengrep) (fallback [Semgrep](https://github.com/semgrep/semgrep)), [Trivy](https://github.com/aquasecurity/trivy) e [OSV-Scanner](https://github.com/google/osv-scanner) + checadores nativos TS de **Slopsquatting**, **DDL Destrutivo** e fallback regex de segredos.
- **Normalizador SARIF 2.1.0:** `SecurityFindingDTO` com `fingerprint` SHA-256 determinístico.
- **Triagem Contextual por IA (`--triage` na CLI, padrão no workflow):** 3 vereditos (`confirmed | false_positive | unknown`) respeitando `suppressed_in_memory`.
- **Trava DAST:** exige host em *allowlist* explícita (ativado na Fase 2).
- **Degradação Graciosa no Modo Zero-Config PC:** checadores nativos TS rodam sempre; binários ausentes **nunca** reportam zero falhas silenciosamente — registram `skipped_missing_binary` no SARIF com instrução de instalação. CLI oferece `factory sec doctor` e `factory sec install-tools` (`~/.factory/bin`). Na imagem Docker do Slice 6, os 4 binários vêm pré-instalados.

---

## 8. Plano Incremental de Construção da Fase 1 (7 Vertical Slices)

Cada Slice deve ser implementado em sua própria branch/worktree. **Não iniciar o Slice N+1 enquanto o Slice N não passar no `.factory/verify`.**

| Slice | Estratégia Aplicada | Escopo Concreto | Critério de Pronto (DoD) |
| :--- | :--- | :--- | :--- |
| **Slice 0 — Walking Skeleton** | *Contract-First + Skeleton* | Monorepo `pnpm` + Turborepo, `packages/contracts` base, `packages/db` dual-mode (PGlite local + switch `DATABASE_URL` Postgres), `apps/web` Next.js + Better Auth + `/api/health`, script CI `scripts/check-no-ee.mjs`. | `pnpm verify` verde; sobe local zero-config com PGlite e sobe contra Postgres via Docker Compose passando o mesmo teste de saúde. |
| **Slice 1 — Hierarquia, Cofre & UI com MSW** | *Frontend-First (MSW) + Domain-First* | Seed cliente `"Internos"`, CRUD `Clients → Projects (+ Repos) → Deliverables`, Cofre AES-256-GCM + `provider_profiles` (OmniRoute/Ollama), telas Sidebar Hierárquica + Kanban + Lista + Configurações de Provedor. | UI navegável 100% com MSW; testes unitários do Cofre (encrypt/decrypt/tamper); Contract Drift Check verde contra as rotas reais. |
| **Slice 2 — OpenCode Bridge, Worktrees & StuckDetector** | *Domain-First + Tests as Data* | `packages/opencode-bridge` (`LocalGitWorktreeWorkspace` + `OpenCodeRunner` `plan`/`build` + `role_bindings`), `packages/skills` (8 `SKILL.md`), `StuckDetector` (5 padrões testados via tabela declarativa). | Teste de integração cria worktree real em repo temporário, executa OpenCode mock/real, valida limpeza de worktree e dispara todos os 5 alertas do `StuckDetector`. |
| **Slice 3 — Workflow Mastra, Descoberta & Estúdio Visual Lite** | *Contract-First + Vertical Slice* | `packages/mastra-runtime` (LibSQLStore/PostgresStore), `deliverableLifecycleWorkflow` com `suspend`/`resume` e lock SQL, Entrevista 2–3 rodadas, Mapa Brownfield leve, Strategy Router (6 estratégias), Estúdio Visual Lite (Moodboard + `.factory/DESIGN.md`) e etapa Spec → Testes antes do Build. | Workflow sobrevive a reinício do processo entre `suspend` e `resume`; testes cobrem entrega → Blueprint → `.factory/DESIGN.md`. |
| **Slice 4 — `.factory/verify`, `security-engine` v1 & Caixa de Decisões** | *Vertical Slice + Dual-Mode* | Auditor estático de Test Anti-Patterns, `packages/security-engine` (Gitleaks + Opengrep/Semgrep + Trivy + OSV-Scanner + Slopsquatting/DDL + SARIF + triagem 3 vereditos), CLI `factory sec scan`, aba Auditoria de Segurança e Caixa de Decisões HITL com Pacote de Evidências + Merge/PR. | **Marco Utilizável #1:** fábrica executa uma entrega real ponta a ponta, roda verify + security scan, pausa na Caixa de Decisões e finaliza o PR; `factory sec scan` funciona standalone. |
| **Slice 5 — Co-piloto Executivo & Memória em 3 Escopos** | *Vertical Slice* | Agente Co-piloto Executivo (Mastra `.network()`, read-only + rascunho) no drawer global via SSE, CRUD/injeção automática de `memories` (`org | client | project`). | Co-piloto responde em streaming; teste comprova ausência de ferramentas de escrita/shell; isolamento impede vazamento entre clientes. |
| **Slice 6 — Empacotamento, Migração & Release (`npx` + Docker)** | *Release Engineering* | `apps/cli` (`factory start`, `factory sec scan`, `factory db migrate-to-postgres`), Dockerfile multi-stage (com os 4 scanners pré-instalados) + `docker-compose.yml` + GitHub Actions (GHCR + npm) + suíte Playwright E2E. | **Marco Fase 1 Completa:** `npx` zero-config funciona no PC; `migrate-to-postgres` transfere dados sem perda; Docker sobe pronto para VPS. |

---

## 9. Especificação das 8 Skills Nativas (`packages/skills/*/SKILL.md`)

Todas as 8 skills já estão incluídas prontas neste kit em `packages/skills/`:
1. `discovery-interview`
2. `brownfield-archaeology`
3. `architecture-blueprint`
4. `visual-design-md`
5. `contract-first-msw`
6. `safe-db-migrations`
7. `test-quality-engineering`
8. `secure-code-audit`

---

## 10. Protocolo `AGENTS.md` e 11. Handoff / Kickoff

Consulte `AGENTS.md`, `.agent/rules/factory-engineering-rules.md` e `PROMPT_KICKOFF_SLICE_0.md` na raiz do kit para as diretivas inegociáveis e o prompt de execução imediata do Slice 0 no Antigravity.
