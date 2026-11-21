# Checklist de Implementação — Uzina Studio (Fase 1 MVP · 7 Vertical Slices)

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

- [ ] **Slice 1 — Hierarquia, Cofre & UI com MSW** (*Frontend-First + Domain-First*)
  - [ ] Seed automático do cliente `"Internos"` e CRUD `Clients → Projects (+ Repos) → Deliverables`
  - [ ] Cofre AES-256-GCM + `provider_profiles` (OmniRoute/Direct/Ollama) com testes unitários (encrypt/decrypt/tamper)
  - [ ] Telas: Sidebar Hierárquica + Kanban + Lista + Configurações de Provedor (navegáveis com MSW)
  - [ ] Contract Drift Check verde contra as rotas reais

- [ ] **Slice 2 — OpenCode Bridge, Worktrees & StuckDetector** (*Domain-First + Tests as Data*)
  - [ ] `@uzina/opencode-bridge` (`LocalGitWorktreeWorkspace` + `OpenCodeRunner` `plan`/`build` + `role_bindings`)
  - [ ] Integração das 8 skills `packages/skills/*/SKILL.md`
  - [ ] `StuckDetector` (5 padrões testados via tabela declarativa *Tests as Data*)
  - [ ] Teste de integração real criando e limpando worktree em repo temporário

- [ ] **Slice 3 — Workflow Mastra, Descoberta & Estúdio Visual Lite** (*Contract-First + Vertical Slice*)
  - [ ] `@uzina/mastra-runtime` (LibSQLStore/PostgresStore) + lock atômico SQL
  - [ ] `deliverableLifecycleWorkflow` com `suspend()`/`resume()` sobrevivendo a restart
  - [ ] Entrevista 2–3 rodadas (5 pilares) + Mapa Brownfield leve + Strategy Router (6 estratégias)
  - [ ] Estúdio Visual Lite (Moodboard + uploads em `/api/assets/:id` + `.uzina/DESIGN.md`)
  - [ ] Etapa `stage_contract_and_tests` executando antes do `stage_build`

- [ ] **Slice 4 — `.uzina/verify`, `security-engine` v1 & Caixa de Decisões** (*Marco Utilizável #1*)
  - [ ] Auditor estático de Test Anti-Patterns (`packages/core/src/test-auditor.ts`)
  - [ ] `@uzina/security-engine` (Gitleaks, Opengrep/Semgrep, Trivy, OSV-Scanner, Slopsquatting/DDL, SARIF, `skipped_missing_binary`, triagem 3 vereditos)
  - [ ] CLI standalone `uzina sec scan`, `uzina sec doctor`, `uzina sec install-tools` + aba Auditoria de Segurança
  - [ ] Caixa de Decisões HITL + Pacote de Evidências + `stage_finalize` (branch local / `gh pr create`)

- [ ] **Slice 5 — Co-piloto Executivo & Memória em 3 Escopos** (*Vertical Slice*)
  - [ ] Co-piloto Executivo (Mastra `.network()`, read-only + rascunho) no drawer global via SSE
  - [ ] Teste comprovando bloqueio de escrita de código e shell no Co-piloto
  - [ ] CRUD e injeção automática de `memories` (`org | client | project`) com isolamento comprovado entre clientes

- [ ] **Slice 6 — Empacotamento, Migração & Release (`npx` + Docker)** (*Marco Fase 1 Completa*)
  - [ ] `apps/cli` (`uzina start`, `uzina dev`, `uzina sec scan`, `uzina db migrate-to-postgres`)
  - [ ] `Dockerfile` multi-stage (com os 4 scanners pré-instalados) + `docker-compose.yml`
  - [ ] GitHub Actions (GHCR + npm) + suíte Playwright E2E completa
