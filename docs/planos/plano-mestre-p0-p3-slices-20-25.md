# Plano Mestre de Implementação & Evolução — Uzina Studio (P0 → P3 · Slices 20 a 25)

**Base:** `main` (`1dde4fa` após auditoria live com OmniRouter `omni-fast`) · **Regra de Execução:** 1 Slice por vez em sua branch dedicada, seguindo Contract-First (`@uzina/contracts`), TDD (`RED → GREEN → REFACTOR`), PGlite em memória, MSW Contract Drift Check e `pnpm verify` verde.

---

## Visão Geral dos Blocos

| Bloco | Slice | Branch | Objetivo Principal |
| :--- | :---: | :--- | :--- |
| **P0** | **Slice 20** | `fix/slice-20-p0-finalize-switcher-cycle-finops` | Correção crítica de `defaultFinalizeRunner` (`local_merge` real + `finalizePolicy` + merge/cleanup sob demanda), sincronização do `Project Switcher` com URL, endpoint dedicado `/api/projects/[id]/autonomous-cycle` + diagnóstico honesto do `Verify Gate`, correção `\$0.0000`, `customPricing` por modelo, freio `budgetCapTokens` e consumo real LLM em `/app/finops`. |
| **P1** | **Slice 21** | `feat/slice-21-p1-visual-llm-qmd-isolation-copilot-chat` | Estúdio Visual generativo real via `visual_designer`, isolamento estrito multi-tenant no QMD e deliverables sem boilerplate `@uzina/*`, Co-piloto Executivo real com `<MarkdownProse>` e escopo do projeto, `Abortar` refletindo `paused`, persistência completa do chat pós-reload e seletor de cliente Greenfield. |
| **P2** | **Slice 22** | `fix/slice-22-p2-mobile-a11y-polish-build` | Zero overflow horizontal em `390x844` (`/app/decisions`), `aria-label` e HTML semântico (`Teto Orçamento`, formulários), remoção de `⌘ ⌘K` duplicado, cards clicáveis no Kanban, preset 1-clique OmniRoute, ajuste de chips em `A+` (`112.5%`) e build Next.js sem warnings do Turbopack. |
| **P3.1–3.2** | **Slice 23** | `feat/slice-23-p3-tool-trace-resumable-sse-semantic-diff` | Timeline live estruturada de Tool Calls + Resumable SSE (`Last-Event-ID` / `?afterEventId=`) + Diff semântico agrupado (`Código` vs `Testes`) com stdout de testes e ajuste localizado por arquivo no HITL. |
| **P3.3–3.4** | **Slice 24** | `feat/slice-24-p3-worktree-gc-studio-history-ast-lock` | Painel **Worktrees & Branches** com GC de órfãos e merge 1-clique, histórico de versões `v1..vN` no Estúdio Visual, e detecção de conflitos / soft-lock semântico por AST para slices paralelos no Kanban. |
| **P3.5–3.6** | **Slice 25** | `feat/slice-25-p3-docker-hotreload-tool-policies-github-pr` | Ativação real do `DockerExecutionWorkspace` via `engine_configs` + probe `/api/health/details`, políticas granulares `Allow / Ask / Deny` por classe de tool, e abertura nativa de Draft PR no GitHub via PAT criptografado no Cofre AES-256-GCM. |

---

## Portão Padrão de Encerramento de Cada Slice
1. Schemas Zod em `@uzina/contracts` e migrações Drizzle compatíveis com PGlite e PostgreSQL.
2. `node scripts/check-no-ee.mjs` = `0`, `node scripts/audit-tests.mjs` = `0` violações.
3. `pnpm verify` (`typecheck` + `lint` + `build` + `test`) e `pnpm test:e2e` (Playwright) 100% verdes.
4. Revisão independente (`test-critic`, `appsec-auditor` quando aplicável, `factory-verifier` e QA visual `browser` multi-viewport).
5. Atualização de `docs/status/ROADMAP_STATUS.md` e `docs/status/PROGRESS_LOG.md`, commit semântico, push e PR para `main`.
