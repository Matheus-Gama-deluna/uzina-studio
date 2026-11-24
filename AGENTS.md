# AGENTS.md — Diretivas de Engenharia do Uzina Studio (Fase 1)

Leia este arquivo integralmente antes de criar ou editar qualquer arquivo neste repositório.

## 1. Identidade e Fontes de Verdade
- **Produto Oficial:** **Uzina Studio** — Fábrica de Software com IA 100% open-source e self-hosted.
- **Convenção do Monorepo:** pacotes `@uzina/*`, CLI `uzina`, pasta de artefatos `.uzina/` e variável de diretório local `UZINA_DATA_DIR` (ver `docs/adr/001-identidade-uzina-studio.md` para mapeamento contra os termos `.factory/` / `FACTORY_DATA_DIR` das specs originais).
- **Blueprint Técnico Obrigatório (Fase 1):** `docs/especificacao-tecnica-fase-1-v1.1.md` (13 tabelas Drizzle + 8 skills em `packages/skills/`).
- **Blueprint Técnico Obrigatório (Fase 2 — Slices 7–10):** `docs/especificacao-tecnica-fase-2-v1.0.md` + `docs/adr/004-codebase-intelligence-qmd-embeddings-stitch.md` (QMD híbrido, `@uzina/codebase-intel`, Google Stitch, `DockerExecutionWorkspace`). `@uzina/codebase-intel` importa apenas `@uzina/contracts` e `@uzina/core`.
- **Visão de Produto e Arquitetura (v2.10):** `docs/especificacao-produto-arquitetura-v2.10.md`.
- **Painel de Status & Progresso:** `docs/status/ROADMAP_STATUS.md`, `docs/status/PROGRESS_LOG.md` e `.uzina/slices-checklist.md`.
- **Constituição de Engenharia:** `.uzina/steering.md`.
- **Dossiê do Slice Ativo:** `docs/slices/slice-0X-<slug>.md`.

---

## 2. Stack Tecnológica e Restrições de Licença

- **Orquestração de Agentes (`Mastra Core` — Apache 2.0 estrito):**
  - Uso exclusivo de pacotes sob licença **Apache 2.0** (`@mastra/core`, `@mastra/memory`, `@mastra/pg`, `@mastra/rag`, `@mastra/libsql`).
  - **PROIBIÇÃO ABSOLUTA**: Nunca instale ou importe módulos `@mastra/*-ee` ou caminhos `ee/` (Enterprise Edition). O script `node scripts/check-no-ee.mjs` deve retornar código `0` sempre.
- **Motor de Codificação e Isolamento (`OpenCode SDK` + `Git Worktrees`):**
  - Agentes executores operam exclusivamente dentro de **Git worktrees isolados** (`.worktrees/task-<id>`) via harness `@uzina/opencode-bridge` com `AbortSignal`, timeout estrito e contenção de path traversal.
  - Nunca alterne modelo LLM no meio da mesma sessão OpenCode (higiene de Prompt Cache).
- **Superfícies Web (`Next.js App Router` — `apps/web`):**
  - Superfície Executiva (Co-piloto, Specs, Aprovações, Entregas em `/exec/*`) e Superfície Técnica (Torre de Controle, Caixa de Decisões, Worktrees, Diffs, Logs SAST em `/app/*`) construídas com React Server Components por padrão, Tailwind CSS v4 + Radix/shadcn (`data-slot`) e validação **Zod** em todas as Server Actions e Route Handlers.
  - Toda UI deve seguir o contrato visual [`.uzina/DESIGN.md`](.uzina/DESIGN.md) e as skills `cockpit-ui-craft` e `ui-visual-qa-critic` (tokens OKLCH, `tabular-nums`, 5 estados de dados, zero "AI slop" e QA visual multi-viewport no `browser`).
- **Autenticação e Controle de Acesso (`Better Auth`):**
  - RBAC multi-tenant validado no servidor em todas as operações de leitura e mutação.
- **Camada de Dados (`Drizzle ORM`: `PGlite` → `PostgreSQL` + `pgvector`):**
  - Schema único em `drizzle-orm/pg-core` compatível com **PGlite** (desenvolvimento local zero-config e testes rápidos em memória) e **PostgreSQL + `pgvector`** (staging/produção).
  - **Regra Crítica de Processo Único no Modo Local (`PGlite`):** quando `DATABASE_URL` não estiver definida, o Painel Next.js e o Mastra Runtime DEVEM rodar no mesmo processo Node.js via singleton `globalThis` (nunca abra `./data/pgdata` em dois processos simultâneos). A CLI `uzina sec scan` roda de forma *stateless* ou envia resultados via HTTP para `/api/security/scans`.
- **Cofre de Provedores (`Provider Vault AES-256-GCM`):**
  - Chaves de API de provedores de LLM/infra jamais ficam em texto claro no banco, em logs ou em commits. Criptografia obrigatória **AES-256-GCM** com IV único de 12 bytes e Authentication Tag de 16 bytes (`MASTER_ENCRYPTION_KEY` / `${UZINA_DATA_DIR}/.master-key` com permissão `0600` no PC local).
  - Uploads nunca ficam em `apps/web/public/`; devem ser armazenados em `${UZINA_DATA_DIR}/uploads/` e servidos exclusivamente via rota autenticada `GET /api/assets/:id`.
- **Módulo de Segurança (`@uzina/security-engine`):**
  - Binários ausentes no PC local devem reportar `skipped_missing_binary` no SARIF (nunca falso verde).

---

## 3. Regras Inegociáveis de Execução

1. **Ordem Estrita de Execução (1 Slice por vez):**
   - Implemente estritamente um Vertical Slice por vez (`Slice 0 → Slice 1 → Slice 2 → Slice 3 → Slice 4 → Slice 5 → Slice 6`), cada um em sua branch (`feat/slice-0X-<slug>`).
   - Nunca inicie o Slice N+1 antes que todos os critérios de pronto (DoD) do Slice N passem em `pnpm verify`, tenham evidências registradas no Dossiê do Slice e sejam aprovados pelo usuário.
2. **Contract-First + Spec → Teste Antes do Build (TDD Estrito):**
   - Sempre defina/atualize schemas Zod e DTOs em `@uzina/contracts` primeiro.
   - Escreva os testes de aceitação/integração do Slice com base nos contratos (RED) antes de implementar o código produtivo (GREEN → REFACTOR).
3. **Qualidade de Código e Testes (Anti-Teatro de Cobertura):**
   - Proibido `any` implícito ou `as unknown as`.
   - Proibido mockar o banco de dados em testes de integração (use PGlite em memória).
   - Proibido mocks hardcoded dentro de componentes React (use MSW na borda de rede validado contra `@uzina/contracts`, com Contract Drift Check).
   - Proibido testes sem asserção real, asserções triviais isoladas (`toBeTruthy()`/`toBeDefined()`), `try/catch` engolindo falha ou `sleep` arbitrário em teste unitário.
   - 3+ casos com mesmo corpo devem ser consolidados em `test.each` (*Tests as Data*).
4. **Pinagem Estrita:**
   - Mantenha `save-exact=true` no `.npmrc` e `--frozen-lockfile` no CI.
5. **Verificação Obrigatória e Higiene de Contexto (`Plan → Execute → Reset`):**
   - Antes de declarar qualquer tarefa pronta, rode `pnpm verify` (`check-no-ee` + `typecheck` + `lint` + `build` + auditor de testes + testes).
   - Ao finalizar um Slice, atualize `.uzina/slices-checklist.md`, `docs/status/ROADMAP_STATUS.md`, `docs/status/PROGRESS_LOG.md` e o Dossiê `docs/slices/slice-0X-*.md`.

---

## 4. Orquestração de Subagentes Globais & Revisão EGM Seletiva

### A. Subagentes Globais (`invoke_subagent` com Model Tiering)
1. **`fast-scout` (`Model: "flash_lite"`):** Reconhecimento rápido de arquivos, símbolos, imports e estrutura de pastas antes de abrir arquivos grandes no agente principal.
2. **`doc-researcher` (`Model: "flash"`):** Consulta de documentação viva via MCP (`mastra-docs`, `context7`) e web, retornando apenas assinaturas e snippets mínimos em Markdown limpo.
3. **`test-critic` (`Model: "flash"`):** Revisão anti-tautologia de testes unitários/E2E, verificando excesso de mocks e edge cases ausentes.
4. **`appsec-auditor` (`Model: "flash"` ou `"pro"`):** Revisão diferencial (`git diff`), SAST, validações Zod e auditoria do cofre AES-256-GCM.
5. **`factory-verifier` (`Model: "inherit"`):** Verificação independente (*Builder vs. Verifier*) executando `tsc --noEmit`, testes e confrontando o `git diff` contra os requisitos em contexto limpo.

### B. Portões Elephant-Goldfish Model (`egm`) — Modo Seletivo
- **Antes de codificar todo Slice (Plan Gate):** rodar `egm-implementation-readiness` sobre `docs/slices/slice-0X-*.md`.
- **Nos Slices de Arquitetura Crítica (Slices 0, 2, 3 e 4):** incluir `egm-design` (e opcionalmente `egm-zoom-out`) no Plan Gate e `egm-codebase-details` / `egm-drift-report` no encerramento.

### C. Protocolo de Velocidade e Economia de Cota
1. **Loop Cirúrgico antes do `pnpm verify`:** durante o ciclo Red-Green-Refactor, execute apenas `pnpm --filter <pacote> typecheck` e o arquivo de teste alvo (ex.: `npx vitest run <arquivo>`). Deixe `pnpm verify` (build completo + todos os pacotes) e `pnpm test:e2e` para a reta final.
2. **Leitura Fatiada (>500 linhas):** delegue ao `fast-scout` (`Model: "flash_lite"`) o mapeamento de símbolos e leia apenas trechos cirúrgicos (`StartLine`/`EndLine`) de arquivos densos (`agency.ts`, `deliverable-lifecycle.ts`, `deliverables-docs-hub.tsx`, `contract-drift.test.ts`).
3. **Testes Dedicados por Slice:** crie `apps/web/tests/sliceXX-*.test.ts` (ou equivalente no pacote) em vez de continuar crescendo `apps/web/tests/contract-drift.test.ts`.
4. **Ordem Econômica de Revisores:** rode `test-critic` (`flash`) e `appsec-auditor` (`flash`, apenas quando o slice alterar auth, cripto, rotas, uploads ou inputs externos) → aplique correções → rode `pnpm verify` → acione `factory-verifier` (`inherit`) **uma única vez** no fechamento. Mantenha o QA de `browser` (`flash`) focado nas telas modificadas.
5. **Reset de Contexto entre Slices:** após merge e atualização de `docs/status/ROADMAP_STATUS.md` e `docs/status/PROGRESS_LOG.md`, recomende `/compact` ou nova sessão para iniciar o Slice seguinte sem carregar histórico acumulado.
