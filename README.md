# Uzina Studio

> **Fábrica de Software com IA** — 100% open-source, self-hosted e orientada a especificações (*Spec-Driven Development*), com máquina de estados durável, execuções isoladas em Git worktrees, auditoria automatizada de qualidade/segurança e aprovação humana baseada em evidências.

---

## Onde Estamos e Para Onde Vamos

* **Painel Vivo de Fases:** [ROADMAP_STATUS.md](docs/status/ROADMAP_STATUS.md)
* **Checklist Técnico dos Slices:** [.uzina/slices-checklist.md](.uzina/slices-checklist.md)
* **Diário de Progresso (Checkpoints):** [PROGRESS_LOG.md](docs/status/PROGRESS_LOG.md)
* **Dossiê Mais Recente (Slice 6):** [slice-06-packaging-release.md](docs/slices/slice-06-packaging-release.md)

---

## Quickstart (Fase 1 Completa)

### 1. Modo Local Zero-Config (PGlite + LibSQL em Processo Único)

```bash
pnpm install
pnpm dev
```

Ou via CLI unificada (`@uzina/cli`):

```bash
pnpm turbo run build
node apps/cli/dist/index.js start --port 3000 --data-dir ./data
node apps/cli/dist/index.js doctor --json
```

> **Atenção:** No Windows, evite salvar `UZINA_DATA_DIR` dentro do OneDrive para prevenir locks `EBUSY`/`EPERM` no PGlite e LibSQL.

### 2. Auditoria AppSec Stateless (`uzina sec`)

```bash
node apps/cli/dist/index.js sec scan . --format summary
node apps/cli/dist/index.js sec doctor
```

### 3. Migração PGlite → PostgreSQL + `pgvector`

Pare o servidor local (`PGlite` usa processo único) e execute:

```bash
node apps/cli/dist/index.js db migrate-to-postgres \
  --from ./data \
  --to "postgresql://uzina:SENHA@host:5432/uzina_prod"
```

### 4. Deploy em VPS via Docker Compose

Defina `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `MASTER_ENCRYPTION_KEY` e `BETTER_AUTH_URL` no `.env` e suba:

```bash
docker compose up -d --build
```

### 5. Verificação Completa de Qualidade

```bash
pnpm verify      # check:no-ee + turbo build + audit:tests + typecheck/lint/test
pnpm test:e2e    # Playwright Chromium E2E contra build de produção
```

---

## Arquitetura Oficial (Fase 1 MVP)

* **Stack:** Node.js 22 LTS, `pnpm` + Turborepo, TypeScript strict, Next.js App Router (`apps/web`), Better Auth, Drizzle ORM (`pg-core`), PGlite / PostgreSQL + `pgvector`, **Mastra Core (Apache 2.0 estrito — zero `ee/`)**, **OpenCode SDK (MIT)** em Git worktrees locais e `@uzina/security-engine` (SARIF 2.1.0).
* **Namespace & CLI:** pacotes `@uzina/*`, binários `uzina` / `uzina-studio`, pasta de artefatos `.uzina/`.

```text
apps/
  ├── web/                     # Painel Next.js App Router (Cockpit + Co-piloto SSE + Estúdio Visual)
  └── cli/                     # CLI @uzina/cli (start, dev, sec, db migrate-to-postgres, doctor)
packages/
  ├── contracts/               # @uzina/contracts — Schemas Zod e DTOs (zero deps internas)
  ├── db/                      # @uzina/db — Drizzle pg-core dual-mode (PGlite ↔ Postgres)
  ├── core/                    # @uzina/core — Domínio puro (StateMachine, StuckDetector, Vault, TestAuditor)
  ├── opencode-bridge/         # @uzina/opencode-bridge — OpenCode SDK + LocalGitWorktreeWorkspace
  ├── security-engine/         # @uzina/security-engine — AppSec dual-mode + SARIF + 3 vereditos
  ├── mastra-runtime/          # @uzina/mastra-runtime — Mastra Core Apache 2.0 (Workflows + Co-piloto + Memórias)
  └── skills/                  # 8 skills nativas SKILL.md para o OpenCode
```

---

## Documentação de Referência

| Documento | Papel |
| :--- | :--- |
| [AGENTS.md](AGENTS.md) | Regras inegociáveis de engenharia e orquestração de subagentes |
| [.uzina/steering.md](.uzina/steering.md) | Constituição técnica resumida do Uzina Studio |
| [Especificação Técnica Fase 1 (v1.1)](docs/especificacao-tecnica-fase-1-v1.1.md) | Blueprint técnico autoritativo da Fase 1 |
| [Especificação de Produto e Arquitetura (v2.10)](docs/especificacao-produto-arquitetura-v2.10.md) | Visão completa de produto (Fases 1 a 3) |
| [ADR-001: Identidade Uzina Studio](docs/adr/001-identidade-uzina-studio.md) | Convenção `@uzina/*`, `uzina`, `.uzina/` e reconciliação v1.1 vs v2.10 |
| [ADR-002: Persistência Dual-Mode](docs/adr/002-persistencia-dual-mode-pglite-postgres.md) | PGlite processo único `globalThis` → PostgreSQL + política de testes |
| [Guia de Setup do Ambiente](docs/SETUP_AMBIENTE.md) | Preparação Windows/Linux, OneDrive, GitHub e ferramentas opcionais |
