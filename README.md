# Uzina Studio

> **Fábrica de Software com IA** — 100% open-source, self-hosted e orientada a especificações (*Spec-Driven Development*), com máquina de estados durável, execuções isoladas em Git worktrees e Docker, auditoria automatizada de qualidade/segurança, aprovação humana baseada em evidências e experiência **Mobile-First PWA com Voz Bidirecional (STT/TTS) e Web Push**.

---

## Onde Estamos e Para Onde Vamos

* **Painel Vivo de Fases:** [ROADMAP_STATUS.md](docs/status/ROADMAP_STATUS.md)
* **Checklist Técnico dos Slices:** [.uzina/slices-checklist.md](.uzina/slices-checklist.md)
* **Diário de Progresso (Checkpoints):** [PROGRESS_LOG.md](docs/status/PROGRESS_LOG.md)
* **Entrega Mais Recente (Slices 36–38):** [plano-mobile-pwa-voz-notificacoes-vps-slices-36-38.md](docs/planos/plano-mobile-pwa-voz-notificacoes-vps-slices-36-38.md)
* **Deploy VPS HTTPS & Uso Mobile (iOS/Android):** [deploy-vps-mobile.md](docs/deploy-vps-mobile.md)

---

## Principais Recursos (Slices 0–38)

* **Orquestração Multi-Agente & Harness:** Workflow durável no **Mastra Core (Apache 2.0 estrito — zero `ee/`)**, **OpenCode SDK (MIT)** em Git worktrees isolados e `DockerExecutionWorkspace`, **16 skills autorais v2** (`SKILL.md` com *Iron Laws*, `references/`, `templates/` e `scripts/`), **14 tools especializadas com RBAC**, `Two-Stage Verifier` com *Risk Briefing*, e gates de `Trajectory Evals` em CI.
* **Inteligência de Código, Memória Híbrida & Estúdio Visual:** `@uzina/codebase-intel` com grafo AST poliglota e esqueleto em Prompt Cache, memória QMD híbrida (BM25 + vetor 384d + RRF + `ObservationalMemory`), e **Estúdio Visual 3 Níveis** + conector **Google Stitch** com sanitização XSS e `<iframe sandbox="">`.
* **Segurança & Governança:** `@uzina/security-engine` (SARIF 2.1.0 + AppSec v2 com DAST passivo, Reachability, CycloneDX 1.5 SBOM e Prompt-Guard), **Cofre AES-256-GCM** (IV 12B, AuthTag 16B), *Tool Policies* (`allow` / `ask` / `deny`), `skills-lock.json` e painel **FinOps** de consumo e economia de tokens.
* **Mobile-First PWA, Voz Bidirecional (STT/TTS) & Web Push (Slices 36–38):** PWA instalável no Android e iOS (`manifest.ts`, `public/sw.js` Turbopack-safe, `/offline`, Share Target `/api/share`), Bottom Tab Bar (`<768px`) + *Bottom Sheets* (`vaul`), fila offline em IndexedDB, transcrição **STT** e síntese **TTS** com `spokenSummary` via Cofre AES-256-GCM (Groq Whisper, OpenAI Audio, Gemini, Kokoro TTS local ou fallback do navegador), **Web Push VAPID** + Central In-App + *Quiet Hours* e *Quick-Decision Cards* em `/app/decisions` e `/app/settings`.

---

## Quickstart

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
node apps/cli/dist/index.js doctor --entropy
```

> **Atenção:** No Windows, evite salvar `UZINA_DATA_DIR` dentro do OneDrive para prevenir locks `EBUSY`/`EPERM` no PGlite e LibSQL. Consulte [SETUP_AMBIENTE.md](docs/SETUP_AMBIENTE.md).

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

### 4. Deploy em VPS com HTTPS & Mobile (Docker Compose)

Para uso mobile completo em produção (PWA instalável, microfone STT e Web Push no iOS/Android), publique atrás de **HTTPS**. Use `.env.example` como base para o seu `.env`:

**Stack completa com Caddy (HTTPS automático):**

```bash
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build
```

*(Opcional)* Para síntese de voz **Kokoro TTS** self-hosted gratuita na mesma VPS:

```bash
docker compose -f docker-compose.yml -f docker-compose.vps.yml --profile voice-local up -d
```

**Proxy externo (Coolify, Dokploy, Traefik, Nginx ou Cloudflare Tunnel):** suba `docker compose up -d --build`, aponte o proxy para a porta `3000` e desative *proxy buffering* nas rotas SSE. Veja o passo a passo completo em [docs/deploy-vps-mobile.md](docs/deploy-vps-mobile.md).

### 5. Verificação Completa de Qualidade

```bash
pnpm verify                                 # check:no-ee + turbo build + audit:tests + typecheck/lint/test
node scripts/audit-agent-trajectories.mjs   # evals determinísticas de trajetória agêntica
pnpm test:e2e                               # Playwright Chromium E2E contra build de produção
```

---

## Arquitetura do Monorepo

* **Stack:** Node.js 22 LTS, `pnpm` + Turborepo, TypeScript strict, Next.js App Router (`apps/web`), Better Auth, Drizzle ORM (`pg-core`), PGlite / PostgreSQL + `pgvector`, **Mastra Core (Apache 2.0 estrito — zero `ee/`)**, **OpenCode SDK (MIT)** em Git worktrees locais e Docker, e `@uzina/security-engine` (SARIF 2.1.0).
* **Namespace & CLI:** pacotes `@uzina/*`, binários `uzina` / `uzina-studio`, pasta de artefatos `.uzina/`.

```text
apps/
  ├── web/                     # Painel Next.js App Router (Cockpit PWA, Voz STT/TTS, Web Push, Estúdio Visual, FinOps, AppSec)
  └── cli/                     # CLI @uzina/cli (start, dev, sec, db migrate-to-postgres, doctor --entropy)
packages/
  ├── contracts/               # @uzina/contracts — Schemas Zod e DTOs (zero deps internas)
  ├── db/                      # @uzina/db — Drizzle pg-core dual-mode (PGlite ↔ PostgreSQL + pgvector)
  ├── core/                    # @uzina/core — Domínio puro (StateMachine, StuckDetector, Vault AES-256-GCM, TestAuditor, skills-lock)
  ├── codebase-intel/          # @uzina/codebase-intel — Grafo AST poliglota, esqueleto Prompt Cache e proveniência
  ├── opencode-bridge/         # @uzina/opencode-bridge — OpenCode SDK + LocalGitWorktreeWorkspace + DockerExecutionWorkspace
  ├── security-engine/         # @uzina/security-engine — AppSec v2 (SARIF 2.1.0, DAST passivo, Reachability, SBOM, Prompt-Guard)
  ├── mastra-runtime/          # @uzina/mastra-runtime — Mastra Core Apache 2.0 (Workflows, Co-piloto, QMD, Voz STT/TTS, Two-Stage Verifier)
  └── skills/                  # 16 skills autorais v2 SKILL.md (references/, templates/, scripts/)
deploy/
  └── Caddyfile                # Proxy reverso HTTPS automático para VPS (SSE sem buffering + headers PWA/segurança)
docker-compose.yml             # Stack padrão (PostgreSQL + pgvector + Uzina Studio)
docker-compose.vps.yml         # Sobreposição VPS (Caddy HTTPS + perfil opcional voice-local com Kokoro TTS)
```

---

## Documentação de Referência

| Documento | Papel |
| :--- | :--- |
| [AGENTS.md](AGENTS.md) | Regras inegociáveis de engenharia e orquestração de subagentes |
| [.uzina/steering.md](.uzina/steering.md) | Constituição técnica resumida do Uzina Studio |
| [Especificação Técnica Fase 1 (v1.1)](docs/especificacao-tecnica-fase-1-v1.1.md) | Blueprint técnico autoritativo da Fase 1 |
| [Especificação Técnica Fase 2 (v1.0)](docs/especificacao-tecnica-fase-2-v1.0.md) | Blueprint técnico da Fase 2 (QMD, Codebase Intel, Stitch, Docker/FinOps) |
| [Especificação de Produto e Arquitetura (v2.10)](docs/especificacao-produto-arquitetura-v2.10.md) | Visão completa de produto (Fases 1 a 3) |
| [ADR-001: Identidade Uzina Studio](docs/adr/001-identidade-uzina-studio.md) | Convenção `@uzina/*`, `uzina`, `.uzina/` e reconciliação v1.1 vs v2.10 |
| [ADR-002: Persistência Dual-Mode](docs/adr/002-persistencia-dual-mode-pglite-postgres.md) | PGlite processo único `globalThis` → PostgreSQL + política de testes |
| [ADR-003: Design System OKLCH](docs/adr/003-design-system-oklch-anti-ai-slop.md) | Sistema visual Warm Stone / OKLCH e diretrizes anti-AI-slop |
| [ADR-004: Codebase Intelligence & Stitch](docs/adr/004-codebase-intelligence-qmd-embeddings-stitch.md) | QMD híbrido, `@uzina/codebase-intel` e arquitetura Google Stitch |
| [Guia de Deploy VPS & Mobile](docs/deploy-vps-mobile.md) | Configuração HTTPS (Caddy ou proxy externo), Kokoro TTS e instalação PWA iOS/Android |
| [Dossiê de Agentes por Fase v2](docs/planos/dossie-agentes-por-fase-v2.md) | Papéis, playbooks, tools e portões dos agentes v2 |
| [Plano Mestre P0–P3 (Slices 20–25)](docs/planos/plano-mestre-p0-p3-slices-20-25.md) | Estabilização, observabilidade SSE, worktrees GC, tool policies e GitHub Draft PR |
| [Plano Mestre Evolução Agêntica v2 (Slices 26–34)](docs/planos/plano-mestre-evolucao-agentes-v2-slices-26-34.md) | Skills v2, 14 tools RBAC, Two-Stage Verifier, Trajectory Evals e AppSec v2 |
| [Plano Mobile PWA, Voz & Push (Slices 36–38)](docs/planos/plano-mobile-pwa-voz-notificacoes-vps-slices-36-38.md) | PWA instalável, STT/TTS bidirecional, Web Push VAPID e prontidão VPS |
| [Guia de Setup do Ambiente](docs/SETUP_AMBIENTE.md) | Preparação Windows/Linux, OneDrive, GitHub e ferramentas opcionais |
| [Handoff de Ambiente, Skills & Plugins](docs/AMBIENTE_SKILLS_PLUGINS_HANDOFF.md) | Portabilidade de skills, regras, subagentes e MCPs entre máquinas |
