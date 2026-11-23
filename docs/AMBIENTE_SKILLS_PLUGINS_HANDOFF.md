# Guia de Continuidade do Ambiente, Skills & Plugins — Uzina Studio

> **Propósito deste documento:** Permitir que você (ou outro agente Antigravity) retome o desenvolvimento do **Uzina Studio** em outra máquina/ambiente mantendo a mesma organização arquitetural, regras de engenharia, catálogo de skills, subagentes, plugins e servidores MCP.
> **Segurança:** Este arquivo contém **apenas nomes de ferramentas, caminhos e variáveis** (nenhuma senha, token ou chave privada está registrada aqui).

---

## 1. Estado Atual & Fontes de Verdade no Repositório

Antes de planejar ou alterar código no novo ambiente, leia na ordem abaixo:

1. **Constituição & Regras Gerais:** [`AGENTS.md`](../AGENTS.md) e [`.uzina/steering.md`](../.uzina/steering.md)
2. **Painel de Status & Progresso:** [`docs/status/ROADMAP_STATUS.md`](status/ROADMAP_STATUS.md), [`docs/status/PROGRESS_LOG.md`](status/PROGRESS_LOG.md) e [`.uzina/slices-checklist.md`](../.uzina/slices-checklist.md) *(Slices 0 a 17 concluídos e integrados na `main`)*
3. **Contrato Visual UI/UX:** [`.uzina/DESIGN.md`](../.uzina/DESIGN.md) *(Warm Stone 4 degraus, disciplina 90/10, `A- | A | A+`)*
4. **Blueprints Técnicos:** [`docs/especificacao-tecnica-fase-1-v1.1.md`](especificacao-tecnica-fase-1-v1.1.md), [`docs/especificacao-tecnica-fase-2-v1.0.md`](especificacao-tecnica-fase-2-v1.0.md), [`docs/especificacao-produto-arquitetura-v2.10.md`](especificacao-produto-arquitetura-v2.10.md)
5. **Repositório Oficial (`origin`):** `https://github.com/Matheus-Gama-deluna/uzina-studio.git` (branch padrão `main`)

---

## 2. Toolchain Base, Scripts & Variáveis de Ambiente

### Ferramentas Verificadas
- **Node.js:** `v22.19.0` (Node 22 LTS)
- **pnpm:** `12.21.0` (`save-exact=true` no `.npmrc`, usar `--frozen-lockfile` no CI)
- **Git:** `2.51.0`
- **Banco Local / Staging:** Modo zero-config com **PGlite** em `${UZINA_DATA_DIR}` ou **PostgreSQL + `pgvector:pg16`** via `docker-compose.dev.yml`

### Scripts do Monorepo (`package.json`)
| Script | Comando | Uso |
| :--- | :--- | :--- |
| `pnpm dev` | `turbo run dev` | Sobe servidores de desenvolvimento |
| `pnpm build` | `turbo run build` | Build de produção dos pacotes e `apps/web` |
| `pnpm typecheck` | `turbo run typecheck` | Verificação estrita TypeScript (`tsc --noEmit`) |
| `pnpm lint` | `turbo run lint` | ESLint em todo o monorepo |
| `pnpm test` | `turbo run test` | Suíte Vitest dos pacotes e rotas API |
| `pnpm test:e2e` | `pnpm --filter @uzina/web test:e2e` | Jornada completa no Playwright (`apps/web/e2e/smoke.spec.ts`) |
| `pnpm check:no-ee` | `node scripts/check-no-ee.mjs` | Bloqueia qualquer dependência comercial `@mastra/*-ee` |
| `pnpm audit:tests` | `node scripts/audit-tests.mjs` | Auditoria anti-teatro de cobertura em testes |
| `pnpm verify` | `check:no-ee && build && audit:tests && typecheck lint test` | Portão completo de validação do workspace |

### Variáveis de Ambiente (ver [`.env.example`](../.env.example))
- `NODE_ENV`, `PORT`
- `UZINA_DATA_DIR` (ex.: `./data` ou pasta fora do OneDrive no Windows para evitar locks `EPERM`/`EBUSY`)
- `DATABASE_URL`, `TEST_DATABASE_URL` (opcional em modo PGlite; apontar para Postgres + `pgvector` quando ativo)
- `MASTER_ENCRYPTION_KEY` (32 bytes hex / 64 chars para o cofre AES-256-GCM; gerada automaticamente em `.master-key` `0600` no modo local se omitida)
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- `OMNIROUTE_BASE_URL`, `OMNIROUTE_API_KEY` (bootstrap opcional)

---

## 3. Camada 1 — Customizações Versionadas no Git (Automáticas após `git clone`)

Tudo abaixo já acompanha o repositório automaticamente ao clonar a branch `main`:

### A. Regras de Workspace (`.agents/rules/`)
- `uzina-engineering-rules.md` — Ordem de slices, fronteiras de importação entre pacotes `@uzina/*`, proibição de `ee/` e obrigação de atualização de status.
- `mastra-core.md` — Padrões Mastra Core (somente Apache 2.0) para workflows duráveis, redes e memória.
- `ui-craft-standards.md` — Regras de design tokens OKLCH, `tabular-nums`, MSW na borda de rede e QA visual.

### B. Skills do Repositório (`.agents/skills/`)
1. `appsec-engine-sarif-pipeline` — Motor AppSec (`@uzina/security-engine`) e parsing SARIF 2.1.0.
2. `better-auth-multitenant-rbac` — Autenticação multi-tenant, organizações e RBAC no servidor.
3. `cockpit-ui-craft` — Design e implementação Tailwind CSS v4 + Radix/shadcn no `apps/web`.
4. `dual-surface-cockpit` — Arquitetura das superfícies `/exec/*` e `/app/*`.
5. `execute-slice` — Fluxo completo de execução de slice (Plan Gate → Contract-First → TDD → Verify Gate).
6. `provider-vault-aes-gcm` — Cofre AES-256-GCM (IV 12B, AuthTag 16B) e mascaramento seguro.
7. `ui-visual-qa-critic` — Protocolo determinístico de verificação visual com `browser` e Playwright.

### C. Skills Nativas dos Agentes (`packages/skills/`)
`architecture-blueprint`, `brownfield-archaeology`, `contract-first-msw`, `discovery-interview`, `safe-db-migrations`, `secure-code-audit`, `test-quality-engineering`, `visual-design-md`.

---

## 4. Camada 2 — Customizações Globais do Antigravity (`~/.gemini/config/`)

Os itens abaixo residem na configuração global do usuário no Antigravity (fora do Git do projeto). Ao continuar em outro computador, replique/reinstale esta estrutura em `~/.gemini/config/` (no Windows: `%USERPROFILE%\.gemini\config\`):

### A. Plugins Instalados (`~/.gemini/config/plugins/`)
| Plugin | Skills / Agentes Inclusos | Função no Projeto |
| :--- | :--- | :--- |
| `chrome-devtools-plugin` | `a11y-debugging`, `chrome-devtools`, `cookie-debugging`, `debug-optimize-lcp`, `memory-leak-debugging`, `troubleshooting` | Depuração Chrome DevTools, performance e acessibilidade |
| `context7` | `context7-mcp` (MCP `context7_context7`) | Consulta de documentação atualizada de libs/frameworks |
| `egm` | 7 skills (`egm-bootstrap`, `egm-brainstorm`, `egm-draft`, `egm-drift-report`, `egm-resolve`, `egm-review`, `egm-review-loop`) + 10 agentes (`bootstrap_orchestrator`, `codebase_details`, `comprehension`, `design_critic`, `implementation_readiness`, `inventive_catalyst`, `structural`, `style`, `synthesizer`, `zoom_out`) | Revisão estrutural e arquitetural no Plan Gate e encerramento de slices |
| `mobbin` | `best-practices`, `plain-writing`, `redesign-screen`, `search` | Pesquisa de referências reais de UX/UI e redesign de telas |
| `modern-web-guidance-plugin` | `chrome-extensions`, `modern-web-guidance` | Boas práticas atualizadas de HTML/CSS/DOM/web APIs |

### B. Servidores MCP (`~/.gemini/config/mcp_config.json` + plugins)
- **`context7_context7`** (`resolve-library-id`, `query-docs`)
- **`maestro`** (`maestro`, `executar`, `validar`, `analisar`, `contexto`)
- **`mastra-docs`** (`mastraDocs`, `mastraMigration`, `searchMastraDocs`, `readMastraDocs`, cursos/exports Mastra)

### C. Subagentes Globais & Model Tiering (`~/.gemini/config/agents/`)
| Subagente | Arquivo | Modelo Recomendado | Papel |
| :--- | :--- | :---: | :--- |
| `fast-scout` | `fast-scout.md` | `flash_lite` | Reconhecimento rápido de arquivos, símbolos e imports |
| `doc-researcher` | `doc-researcher.md` | `flash` | Pesquisa de docs vivas via Context7/Mastra Docs/Web |
| `test-critic` | `test-critic.md` | `flash` | Detecção de testes tautológicos, mocks excessivos e lacunas |
| `appsec-auditor` | `appsec-auditor.md` | `flash` / `pro` | Revisão diferencial SAST, Zod e criptografia AES-256-GCM |
| `factory-verifier` | `factory-verifier.md` | `inherit` | Verificação independente *Builder vs. Verifier* |

### D. Regras Globais (`~/.gemini/config/rules/`)
- `drizzle-pglite.md` — Convenções de schema e testes em PGlite/Postgres.
- `nextjs-surfaces.md` — Regras das superfícies Next.js App Router.
- `security-vault.md` — Regras do cofre AES-256-GCM, segredos e RBAC Better Auth.
- `subagent-economy.md` — Matriz de roteamento econômico de subagentes (`flash_lite` / `flash` / `inherit`).

### E. Skills Globais (`~/.gemini/config/skills/` — 20 skills)
`accessibility-a11y`, `brainstorming`, `code-review-lifecycle`, `drizzle-pglite-migration`, `executing-plans`, `finishing-a-development-branch`, `frontend-clean-architecture`, `mastra-network-patterns`, `nextjs-app-router-patterns`, `opencode-sdk-harness`, `playwright-e2e-testing`, `pwa-offline-resilience`, `react-performance-state`, `static-analysis-security`, `subagent-cost-orchestration`, `systematic-debugging`, `test-driven-development`, `using-git-worktrees`, `verification-defense`, `writing-plans`.

---

## 5. Checklist de Continuidade em Outro Ambiente

1. **Clonar e instalar dependências:**
   ```bash
   git clone https://github.com/Matheus-Gama-deluna/uzina-studio.git
   cd uzina-studio
   pnpm install --frozen-lockfile
   ```
2. **Restaurar ambiente local (`.env` e diretório de dados):**
   - Copie `.env.example` para `.env` (sem comitar `.env`) e aponte `UZINA_DATA_DIR` para fora de pastas sincronizadas em nuvem (ex.: fora do OneDrive).
   - Opcional (recomendado para testes completos): suba o Postgres + `pgvector` com `docker compose -f docker-compose.dev.yml up -d`.
3. **Replicar a Camada Global do Antigravity (`~/.gemini/config/`):**
   - Copie seus diretórios `~/.gemini/config/agents/`, `rules/` e `skills/` (opcionalmente via backup cifrado ou repositório privado de dotfiles).
   - Instale pelo **Plugins Manager** os 5 plugins: `chrome-devtools-plugin`, `context7`, `egm`, `mobbin` e `modern-web-guidance-plugin`.
   - Reconfigure no `~/.gemini/config/mcp_config.json` os servidores MCP `maestro` e `mastra-docs`.
4. **Validar saúde do novo ambiente antes de codificar:**
   ```bash
   pnpm verify
   pnpm test:e2e
   ```

### Prompt Pronto de Retomada no Novo Ambiente
> Leia `AGENTS.md`, `docs/status/ROADMAP_STATUS.md`, `docs/status/PROGRESS_LOG.md`, `.uzina/DESIGN.md` e `docs/AMBIENTE_SKILLS_PLUGINS_HANDOFF.md`. Confirme com `pnpm check:no-ee` e `git status` que o ambiente está íntegro na branch `main` e aguarde minha instrução para o próximo slice.
