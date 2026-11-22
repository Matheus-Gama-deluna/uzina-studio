# Dossiê do Slice 10 — `DockerExecutionWorkspace` & FinOps de Tokens

* **Status:** `Concluído`
* **Branch:** `feat/slice-10-docker-workspace-finops`
* **Estratégia Aplicada:** *Domain-First + Release Engineering + Vertical Slice*
* **Spec de Referência:** `docs/especificacao-tecnica-fase-2-v1.0.md` (§7) · [ADR-004](../adr/004-codebase-intelligence-qmd-embeddings-stitch.md)

---

## 1. Objetivo e Escopo Estrito
**Entrega:** segunda implementação de `ExecutionWorkspace` (`DockerExecutionWorkspace`) com containers efêmeros isolados e painel FinOps mostrando tokens economizados (Prompt Cache, QMD, grafo AST, esqueleto) e Rework Rate.

**Fora de escopo:** Daytona, Best-of-N, filas multi-worker, Kubernetes.

## 2. Fronteiras de Pacotes e Arquivos Previstos
- `packages/opencode-bridge/src/docker-workspace.ts` (+ testes de integração reais, `skipIf` sem Docker)
- `packages/contracts/src/finops.ts` · `tests/slice10-contracts.test.ts`
- `packages/db/src/schema/finops.ts` (`token_savings_events`) + migração `0009_*.sql`
- `packages/mastra-runtime/src/finops/{collector.ts,queries.ts}`; seleção do workspace por configuração (`UZINA_WORKSPACE=worktree|docker`)
- `apps/web`: `/api/finops/summary`, tela `/app/finops` (cartões + série temporal), MSW + Contract Drift
- `apps/cli`: `uzina doctor` reporta disponibilidade do Docker

## 3. Contratos Compartilhados
`WorkspaceKindSchema`, `FinopsSummaryRequestSchema` (`from`, `to`, `projectId?`), `FinopsSummarySchema` (`cacheHitRate`, `tokensSavedByTechnique`, `reworkRate`, `estimatedCostSavedUsd`), `TokenSavingsEventSchema`.

## 4. Persistência, Segurança e Decisões Técnicas
- Container: `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only` + tmpfs, usuário não-root, `--network none` por padrão (rede só via allowlist explícita), limites `--cpus/--memory/--pids-limit`, timeout + `AbortSignal`, bind-mount **apenas** do worktree da tarefa, limpeza garantida.
- Imagem pinada por digest; sem montar `docker.sock`; sem variáveis de ambiente do host além das efêmeras do Cofre.
- Cálculo de economia sempre vs. **baseline medido** (nunca estimativa inventada); eventos filtrados por `organization_id`.

## 5. Plano de Testes
* **Unitários:** montagem de argumentos `docker run` (tabela declarativa: flags de segurança obrigatórias), cálculo de FinOps.
* **Integração (Docker real, `skipIf(!docker)`):** criar/limpar workspace, escrita restrita ao worktree, rede bloqueada, timeout mata o container, nenhum container órfão.
* **Segurança:** tentativa de path traversal, montagem proibida, `docker.sock` ausente.
* **Visual (`browser`):** `/app/finops`.

## 6. Critérios de Pronto (DoD)
- [x] Verify Gate sem cache (`0 skipped` em PostgreSQL + `pgvector` live)
- [x] Paridade de comportamento com `LocalGitWorktreeWorkspace` (mesma interface `ExecutionWorkspace` + hardening `buildDockerRunArgs`)
- [x] Painel FinOps (`/app/finops`) com dados reais dos Slices 7–8
- [x] QA visual aprovado; docs de fase atualizados; branch enviada

## 7. Revisão EGM Pré-Código (Plan Gate)
- **Hardening de Container (`DockerExecutionWorkspace`):** `buildDockerRunArgs` impõe `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only`, `--tmpfs /tmp:rw,noexec,nosuid,size=64m`, `--user 1001:1001` (bloqueia `0`/`root`), `--network none` (rede só via allowlist explícita), `--cpus`, `--memory`, `--pids-limit`, bind-mount exclusivo do worktree (`/workspace`), proibição de `docker.sock` e remoção garantida via `docker rm -f` em timeout/abort/`cleanup()`.
- **Seleção de Workspace:** `UZINA_WORKSPACE=worktree|docker` (padrão `worktree`) via `createConfiguredExecutionWorkspace`.
- **FinOps baseado em medições reais:** `token_savings_events` grava `tokens_baseline` e `tokens_actual` medidos em QMD, grafo AST/slices e esqueleto Prompt Cache, sempre filtrados por `organization_id`, calculando `cacheHitRate`, `reworkRate` e `estimatedCostSavedUsd`.

## 8. Evidências Reais Pós-Código (Verify Gate)
* **`node scripts/check-no-ee.mjs`:** exit `0`.
* **`pnpm turbo run build --force`:** `Tasks: 9 successful, 9 total` (`0 cached`).
* **`node scripts/audit-tests.mjs`:** `Arquivos: 63 | Testes: 192 | Suprimidos: 2 | Violações: 0`.
* **`pnpm turbo run typecheck lint test --force` (com `TEST_DATABASE_URL=postgresql://uzina:uzina@127.0.0.1:5432/uzina_dev` em `pgvector/pgvector:pg16`):** `Tasks: 34 successful, 34 total` (`0 cached`), **`480 passed | 0 skipped`**:
  * `@uzina/contracts`: `10 passed (10)`, `152 passed (152)`
  * `@uzina/core`: `13 passed (13)`, `149 passed (149)`
  * `@uzina/security-engine`: `3 passed (3)`, `19 passed (19)`
  * `@uzina/codebase-intel`: `1 passed (1)`, `8 passed (8)`
  * `@uzina/cli`: `1 passed (1)`, `13 passed (13)`
  * `@uzina/opencode-bridge`: `4 passed (4)`, `51 passed (51)` (incluindo `docker-workspace.test.ts`)
  * `@uzina/db`: `12 passed (12)`, `39 passed (39)` (incluindo `postgres-live.test.ts` sem skips)
  * `@uzina/mastra-runtime`: `8 passed (8)`, `21 passed (21)`
  * `@uzina/web`: `11 passed (11)`, `28 passed (28)` (incluindo `slice10-api.test.ts` e `contract-drift.test.ts`)
* **`pnpm --filter @uzina/web test:e2e` (Playwright):** `2 passed (14.2s)`.
* **QA Visual (`browser`, `Model: "flash"` em `http://localhost:3050/app/finops`):** **PASS** — 4 KPIs, badge `workspace: worktree`, 4 linhas de técnica, registro manual `12000 → 1200` atualizando para `10.800` (`90% vs baseline`, `Cache Hit Rate 90%`, `US$ 0.0324`), `0` erros de console, `0` HTTP `>= 500`, `0` overflow horizontal em Desktop Dark/Light (`1440×900`) e Mobile (`390×844`).
