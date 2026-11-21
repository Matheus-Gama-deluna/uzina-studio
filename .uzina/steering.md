# Constituição de Engenharia — Uzina Studio (`.uzina/steering.md`)

- **Identidade e Licenciamento:** O produto oficial é o **Uzina Studio** (pacotes `@uzina/*`, CLI `uzina`, pasta de artefatos `.uzina/`). 100% open-source e self-hosted. Zero módulos `ee/` do Mastra, zero vendor lock-in de prototipagem ou provedor LLM.
- **Arquitetura:** Monorepo `pnpm` + Turborepo com fronteiras rígidas entre `contracts`, `db`, `core`, `opencode-bridge`, `security-engine`, `mastra-runtime`, `ui`, `apps/web` e `apps/cli` (sob o namespace `@uzina/*`).
- **Dialeto Único de Banco:** Drizzle ORM (`pg-core`) rodando em PGlite (local zero-config, processo único via `globalThis`) e PostgreSQL + `pgvector` (VPS via `DATABASE_URL`).
- **Estratégias de Construção:** Contract-First (`@uzina/contracts`), Walking Skeleton + Vertical Slices, Frontend-First + MSW (`apps/web`), Domain-First + Tests as Data (`@uzina/core`).
- **Higiene de Prompt Cache:** Roteamento fixo por papel; prefixo estático (system prompt + `.uzina/steering.md` + `.uzina/DESIGN.md`); nunca alternar modelo LLM no meio de uma sessão OpenCode.
- **Qualidade de Testes:** Isolamento Spec → Teste, zero mocks internos em integração, auditor estático de *test anti-patterns*, `test.each` para 3+ casos equivalentes e Contract Drift Check.
- **Segurança:** Cofre AES-256-GCM (IV 12 bytes, AuthTag 16 bytes) para chaves de provedor, uploads servidos apenas por rota autenticada `GET /api/assets/:id`, `@uzina/security-engine` dual-mode (SARIF 2.1.0 + triagem em 3 vereditos + degradação graciosa `skipped_missing_binary`).
