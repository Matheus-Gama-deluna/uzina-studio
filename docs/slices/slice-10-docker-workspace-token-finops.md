# Dossiê do Slice 10 — `DockerExecutionWorkspace` & FinOps de Tokens

* **Status:** `Rascunho`
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
- [ ] Verify Gate sem cache; testes Docker executados no WSL2/CI
- [ ] Paridade de comportamento com `LocalGitWorktreeWorkspace` (mesma suíte de contrato)
- [ ] Painel FinOps com dados reais dos Slices 7–8
- [ ] QA visual; docs de fase; branch/PR

## 7. Revisão EGM Pré-Código (Plan Gate)
*(`egm-implementation-readiness` + `egm-design` + `appsec-auditor` para isolamento.)*

## 8. Evidências Reais Pós-Código (Verify Gate)
*(Preencher ao concluir.)*
