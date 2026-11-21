# Uzina Studio

> **Fábrica de Software com IA** — 100% open-source, self-hosted e orientada a especificações (*Spec-Driven Development*), com máquina de estados durável, execuções isoladas em Git worktrees, auditoria automatizada de qualidade/segurança e aprovação humana baseada em evidências.

---

## Onde Estamos e Para Onde Vamos

* **Painel Vivo de Fases:** [ROADMAP_STATUS.md](docs/status/ROADMAP_STATUS.md)
* **Checklist Técnico dos Slices:** [.uzina/slices-checklist.md](.uzina/slices-checklist.md)
* **Diário de Progresso (Checkpoints):** [PROGRESS_LOG.md](docs/status/PROGRESS_LOG.md)
* **Próximo Dossiê (Slice 0):** [slice-00-walking-skeleton.md](docs/slices/slice-00-walking-skeleton.md)

---

## Arquitetura Oficial (Fase 1 MVP)

* **Stack:** Node.js 22 LTS, `pnpm` + Turborepo, TypeScript strict, Next.js App Router (`apps/web`), Better Auth, Drizzle ORM (`pg-core`), PGlite (local zero-config) / PostgreSQL + `pgvector` (VPS), **Mastra Core (Apache 2.0 estrito — zero `ee/`)**, **OpenCode SDK (MIT)** em Git worktrees locais e `packages/security-engine` (SARIF 2.1.0).
* **Namespace & CLI:** pacotes `@uzina/*`, binário CLI `uzina` (`uzina start`, `uzina sec scan`, `uzina db migrate-to-postgres`), pasta de artefatos `.uzina/`.

```text
apps/
  ├── web/                     # Painel Next.js App Router (Superfície Executiva + Técnica)
  └── cli/                     # CLI `uzina` (npx + Docker)
packages/
  ├── contracts/               # @uzina/contracts — Schemas Zod e DTOs (zero deps internas)
  ├── db/                      # @uzina/db — Drizzle pg-core dual-mode (PGlite ↔ Postgres)
  ├── core/                    # @uzina/core — Domínio puro (StateMachine, StuckDetector, Vault, TestAuditor)
  ├── opencode-bridge/         # @uzina/opencode-bridge — OpenCode SDK + LocalGitWorktreeWorkspace
  ├── security-engine/         # @uzina/security-engine — AppSec dual-mode + SARIF + 3 vereditos
  ├── mastra-runtime/          # @uzina/mastra-runtime — Mastra Core Apache 2.0 (Workflows + Co-piloto .network())
  ├── skills/                  # 8 skills nativas SKILL.md para o OpenCode
  └── ui/                      # @uzina/ui — Design System compartilhado
```

---

## Documentação de Referência

| Documento | Papel |
| :--- | :--- |
| [AGENTS.md](AGENTS.md) | Regras inegociáveis de engenharia e orquestração de subagentes |
| [.uzina/steering.md](.uzina/steering.md) | Constituição técnica resumida do Uzina Studio |
| [Especificação Técnica Fase 1 (v1.1)](docs/especificacao-tecnica-fase-1-v1.1.md) | Blueprint técnico autoritativo da Fase 1 (13 tabelas + 7 Slices) |
| [Especificação de Produto e Arquitetura (v2.10)](docs/especificacao-produto-arquitetura-v2.10.md) | Visão completa de produto (Fases 1 a 3) |
| [ADR-001: Identidade Uzina Studio](docs/adr/001-identidade-uzina-studio.md) | Convenção `@uzina/*`, `uzina`, `.uzina/` e reconciliação v1.1 vs v2.10 |
| [ADR-002: Persistência Dual-Mode](docs/adr/002-persistencia-dual-mode-pglite-postgres.md) | PGlite processo único `globalThis` → PostgreSQL + política de testes |
| [Guia de Setup do Ambiente](docs/SETUP_AMBIENTE.md) | Preparação Windows/Linux, OneDrive, GitHub e ferramentas opcionais |
