# Diário de Progresso & Checkpoints — Uzina Studio

Registro cronológico curto de cada fase ou slice concluído, decisões tomadas e próximo passo recomendado.

---

## 2026-11-21 — Fase 0: Bootstrap, Governança e Dossiê do Slice 0

* **Identidade travada:** Produto **Uzina Studio**, namespace `@uzina/*`, CLI `uzina`, pasta `.uzina/`, variável `UZINA_DATA_DIR` (ADR-001).
* **Ambiente:** `pnpm@12.21.0` ativado; `git init -b main` executado; `.gitignore` robusto criado; `.npmrc` (`save-exact=true`) e `.env.example` configurados.
* **Kit extraído e corrigido:**
  * Specs preservadas em `docs/especificacao-produto-arquitetura-v2.10.md` e `docs/especificacao-tecnica-fase-1-v1.1.md`.
  * 8 skills nativas extraídas em `packages/skills/*/SKILL.md` e alinhadas a `.uzina/`.
  * Corrigido bug de regex em `scripts/check-no-ee.mjs` (o espaço literal após `-ee` impediria bloqueio de `"@mastra/foo-ee"`).
  * `AGENTS.md` mesclado preservando invariantes prévios + regras do kit + protocolo EGM seletivo; regras e workflow `/execute-slice` criados em `.agents/`.
* **Controle de fases implantado:** `ROADMAP_STATUS.md`, `PROGRESS_LOG.md`, `.uzina/slices-checklist.md`, `docs/adr/000-002`, `docs/slices/00-template-slice.md`, `docs/SETUP_AMBIENTE.md`.
* **Dossiê do Slice 0:** `docs/slices/slice-00-walking-skeleton.md` elaborado, verificado contra versões reais no npm/Context7 e auditado pelo Plan Gate EGM (`egm-implementation-readiness` + `egm-design`), resolvendo 6 BLOCKERs, 5 WARNINGs e 10 achados arquiteturais antes da primeira linha de código.
* **Próximo passo:** Aprovação do usuário para abrir a branch `feat/slice-00-walking-skeleton` e implementar o **Slice 0**.

---

## 2026-11-21 — Slice 0: Walking Skeleton (`feat/slice-00-walking-skeleton`)

* **Entregue:**
  * Monorepo `pnpm@12.21.0` + Turborepo v2 (`turbo@2.11.13`), `tsconfig.base.json` strict (`typescript@5.9.3`), `eslint.config.mjs` (bloqueando `any` e `as unknown as`), `docker-compose.dev.yml` (`pgvector/pgvector:pg16`).
  * `@uzina/contracts`: 11 enums base + `HealthPublicSchema` + `HealthDetailsSchema` (`21/21` testes).
  * `@uzina/db`: schema Drizzle `pg-core` (5 tabelas UUID com índices), migração `0000_living_thunderbird.sql` automática no cold start, singleton `Symbol.for("@uzina/db/singleton")`, fail-fast em `DATABASE_URL` inválida (`15/15` testes PGlite/unit + `1 skipped` `postgres-live` sem `TEST_DATABASE_URL`).
  * `apps/web`: Next.js `16.4.6` App Router + Better Auth `1.7.27` lazy + `GET /api/health` (`200`/`503`) + `GET /api/health/details` autenticado (`401`/`200`/`503`) + painel inicial (`12/12` testes integração real).
* **Validação & Verificadores:**
  * `pnpm verify`: **12/12 tasks verdes** (exit `0`).
  * `browser` (`flash`): `http://localhost:3000` e `/api/health` validados visualmente em desktop (`1280x800`) e mobile (`390x844`), zero erros de console/rede.
  * `test-critic`, `appsec-auditor`, `egm-codebase-details` e `factory-verifier`: **PASS** final após incorporar todas as bordas e ajustes `LOW`.
* **Próximo passo:** Aprovar/mergear PR do Slice 0 e iniciar o Dossiê + Plan Gate EGM do **Slice 1 (Hierarquia, Cofre AES-256-GCM & UI com MSW)**.

---

## 2026-11-21 — Slice 1: Hierarquia, Cofre AES-256-GCM & UI com MSW (`feat/slice-01-hierarchy-vault-ui`)

* **Entregue:**
  * `@uzina/contracts`: schemas Zod completos (`clients`, `projects`, `deliverables`, `providers`, `errors`, `HttpUrlSchema`, `ProviderProfilePublicSchema.strict()`) (`38/38` testes).
  * `@uzina/core`: Cofre AES-256-GCM (IV 12B, AuthTag 16B, AAD `${orgId}:${providerType}`, `MasterKeyInputSchema`, `maskApiKey`) e `StateMachine` (`@uzina/core/state-machine`) (`37/37` testes).
  * `@uzina/db`: 5 tabelas (`clients`, `projects`, `project_repositories`, `deliverables`, `provider_profiles`), migrações `0001`/`0002`, seed `"Internos"` + isolamento de signup aberto (`17/17` testes + `1 skipped` `postgres-live`).
  * `apps/web`: 9 rotas REST com RBAC multi-tenant + anti-IDOR, MSW v3 + Contract Drift Check (`15/15` testes), e Cockpit em Tailwind CSS v4 OKLCH Dark/Light (`/login`, `/app` Kanban ↔ Lista + `Cmd+K`, `/app/providers`).
* **Validação & Verificadores:**
  * `pnpm verify`: **107 testes aprovados**, `next build`, `tsc --noEmit` e `eslint` com `0` erros e `0` warnings (`exit 0`).
  * `browser` (`flash`): fluxo completo E2E em `http://localhost:3000` (Dark/Light, `1280×800`, `768×1024`, `390×844`) validado sem erros de console/HTTP e sem exposição de chave privada.
  * `appsec-auditor`, `test-critic` e `factory-verifier`: **PASS** após aplicação de todas as correções.
* **Próximo passo:** Iniciar o Dossiê + Plan Gate EGM (`egm-implementation-readiness` + `egm-design`) e implementação do **Slice 2 (`@uzina/opencode-bridge`, Worktrees & `StuckDetector`)**.

---

## 2026-11-21 — Slice 2: OpenCode Bridge, Git Worktrees, 8 Skills & `StuckDetector` (`feat/slice-02-opencode-bridge-stuck-detector`)

* **Entregue:**
  * `@uzina/contracts`: `src/execution.ts` (contratos Zod v4 para worktrees, exec, skills, configuração server-side de provedor, observações de turno, 5 padrões `StuckDetector`, `OpenCodeRunSessionOptionsSchema` e `OpenCodeSessionResultSchema`) + proteção anti-IMDS em `HttpUrlSchema` (`62/62` testes).
  * `@uzina/core`: `src/redact.ts` (`redactSecrets`, `redactSecretsInValue`, `redactError`, browser-safe), `src/path-guard.ts` (contenção anti-traversal/dangling symlinks/UNC/ADS/nomes reservados Windows, `sanitizeWorktreeSlug`, `assertSafeGitRef`), `src/stuck-detector.ts` (5 padrões OpenHands puros, zero `node:*`, export `./stuck-detector`) e `src/skills-loader.ts` (carregamento validado das 8 skills reais de `packages/skills/*/SKILL.md`, `97/97` testes).
  * `@uzina/opencode-bridge`: novo pacote com `@opencode-ai/sdk@1.19.6` (MIT), `LocalGitWorktreeWorkspace` (worktrees Git isoladas, `shell: false`, allowlist de `env`, parser de flags globais `git`, kill completo da árvore de processos, `getDiff` com *untracked* e limpeza idempotente), `SdkOpenCodeTransport` (processo embedded isolado sem mutar `process.env`/`XDG_*`, SSE `/event` em tempo real *fail-closed*, `PLAN_MODE_PERMISSION_RULESET`), `InMemoryOpenCodeTransport` (`./testing`) e `OpenCodeRunner` (Prompt Cache fixo por papel, isolamento `plan` em 3 camadas, cofre AES-256-GCM efêmero, `maxSteps`, `AbortSignal`/`timeoutMs` e `StructuredOutput`, `44/44` testes).
* **Validação & Verificadores:**
  * `node scripts/check-no-ee.mjs`: exit `0`.
  * `pnpm verify` sem cache (`build --force` + `typecheck lint test --force`): **235 testes aprovados** (`1 skipped` `postgres-live` sem `TEST_DATABASE_URL`), **0 erros/warnings** ESLint/Turbopack.
  * Plan Gate EGM (`egm-implementation-readiness` + `egm-design`) aprovado pré-código; Verify Gate (`appsec-auditor`, `test-critic`, `egm-codebase-details`, `factory-verifier`) **PASS** unânime pós-código.
* **Próximo passo:** Elaborar Dossiê + Plan Gate EGM (`egm-implementation-readiness` + `egm-design`) e implementar o **Slice 3 (`@uzina/mastra-runtime` & Estúdio Visual Lite)**.
