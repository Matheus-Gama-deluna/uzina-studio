# Dossiê do Slice 5 — Co-piloto Executivo (`.network()`) & Memória em 3 Escopos

* **Status:** `Concluído`
* **Branch:** `feat/slice-05-copilot-memories`
* **Estratégia Aplicada:** *Vertical Slice + Contract-First + Strict TDD*
* **Spec de Referência:** `docs/especificacao-tecnica-fase-1-v1.1.md` (Seções 4.2 #8, 5.1, 6.4, 8)

---

## 1. Objetivo e Escopo Estrito
Entrega o **Co-piloto Executivo** (Mastra `Agent` + `.network()` com restrições duras read-only + rascunho em `discovery` + disparo de scan de segurança) no drawer global via SSE (`/api/copilot/chat`) e o CRUD/injeção hierárquica automática de **`memories`** nos 3 escopos (`org | client | project`) com isolamento estrito entre clientes.

Fora de escopo (Slice 6): `apps/cli` completo (`uzina start`), Dockerfile multi-stage, docker-compose e Playwright E2E final.

## 2. Fronteiras & Contratos (`@uzina/contracts`)
- `src/memories.ts`: `MemoryCategorySchema`, `MemorySchema`, `MemoryListResponseSchema`, `CreateMemorySchema.strict()`, `UpdateMemorySchema.strict()`.
- `src/copilot.ts`: `CopilotMessageSchema`, `CopilotChatRequestSchema.strict()`, `CopilotStreamEventSchema`, `CopilotCapabilitiesSchema`.

## 3. Persistência (`@uzina/db` — Tabela #8)
- `packages/db/src/schema/memories.ts`: tabela `memories` com `organizationId` (FK cascade), `scopeType` (`org | client | project`), `scopeId` (uuid), `category`, `title`, `content`, `sourceDeliverableId` (FK `deliverables.id`, `onDelete: "set null"`), timestamps com timezone, índice composto `(scopeType, scopeId, category)` e índice `(organizationId)` + migração `0005_*.sql`.

## 4. Agente & Isolamento (`@uzina/mastra-runtime`)
- `src/memories.ts`: `assertValidMemoryScope` + `resolveHierarchicalMemories` garantindo que memórias de `Cliente A` nunca vazem para `Cliente B` ou projetos de `Cliente B`, e `formatMemoriesForPrompt` com redação.
- `src/workflows/deliverable-lifecycle.ts`: injeta memórias hierárquicas do projeto em `stage_contract_and_tests` e `stage_build`; em `stage_finalize` (`merged`), grava aprendizado de arquitetura em `memories`.
- `src/agents/executive-copilot.ts`: registra `executiveCopilot` (`@mastra/core/agent`) com apenas `read_workspace_overview`, `draft_deliverable` e `trigger_security_scan` (zero escrita em disco, zero shell/git, zero transição para `merged`). Inclui fallback determinístico offline sem chave externa.

## 5. APIs & UI (`apps/web`)
- `/api/memories` (`GET`, `POST`), `/api/memories/[id]` (`PATCH`, `DELETE`) e `/api/copilot/chat` (`POST` SSE), MSW + `contract-drift.test.ts`, `/app/memories`, drawer global `CopilotDrawer` no `CockpitShell` e atalho `Cmd+K`.

## 6. Critérios de Pronto (DoD)
- [x] `node scripts/check-no-ee.mjs` e `node scripts/audit-tests.mjs` retornam código `0`.
- [x] `pnpm turbo run build --force` e `pnpm turbo run typecheck lint test --force` verdes.
- [x] Testes comprovam isolamento entre clientes em `memories`, streaming SSE `/api/copilot/chat` e ausência de ferramentas de escrita em disco/shell/`merged` no Co-piloto.
- [x] QA Visual (`browser`) aprovado em `/app/memories` e no drawer do Co-piloto (Dark/Light, Desktop/Mobile).
- [x] Artefatos de fase atualizados e branch enviada para `origin`.

## 7. Evidências Reais Pós-Código (Verify Gate)
- `node scripts/check-no-ee.mjs`: exit `0` (`OK [check-no-ee]`).
- `pnpm turbo run build --force`: **7/7 packages** (`0 cached`, 0 warnings no Next.js 16.4.6 Turbopack).
- `node scripts/audit-tests.mjs`: `[audit:tests] Arquivos: 41 | Testes: 147 | Suprimidos: 2 | Violações: 0`.
- `pnpm turbo run typecheck lint test --force`: **27/27 tasks** (`0 cached`):
  - `@uzina/contracts`: `6` files, `115 passed`
  - `@uzina/core`: `11` files, `137 passed`
  - `@uzina/security-engine`: `3` files, `19 passed`
  - `@uzina/opencode-bridge`: `3` files, `45 passed`
  - `@uzina/db`: `6` passed | `1 skipped` (`postgres-live.test.ts` sem `UZINA_TEST_POSTGRES_URL`), `25 passed | 1 skipped`
  - `@uzina/mastra-runtime`: `4` files, `15 passed`
  - `@uzina/web`: `7` files, `24 passed`
  - Total: **380 passed | 1 skipped**
- QA Visual (`browser` `Model: "flash"`, `http://localhost:3045`): **PASS** (`/login`, criação e filtro por escopo em `/app/memories`, drawer `[data-testid="open-copilot-drawer"]` + ação `"Resumo Executivo"` via SSE `200 text/event-stream`, Desktop `1440×900` Dark/Light e Mobile `390×844` com 0 erros de console, 0 HTTP `>=500` e 0 overflow horizontal).
