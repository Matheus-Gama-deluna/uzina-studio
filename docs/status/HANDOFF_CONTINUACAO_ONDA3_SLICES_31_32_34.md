# Handoff de Continuação — Ondas 3 & 4 (Slices 31 UI, 32 e 34)

**Data do Checkpoint:** `2026-11-25`  
**Branch Ativa:** `feat/slices-27-34-agentic-evolution-v2` (enviada ao `origin` no GitHub)  
**Motivo da Pausa:** Atingimento do limite de cota (429 `RESOURCE_EXHAUSTED`) nos modelos disponíveis ao disparar a Onda 3 no `/swarm`. Todo o trabalho das **Ondas 0, 1 e 2** está limpo, testado, commitado e documentado.

---

## 1. Mapa Exato de Commits na Branch (`feat/slices-27-34-agentic-evolution-v2`)

| Ordem | Commit | Escopo Entregue | Status de Verificação |
| :---: | :--- | :--- | :--- |
| Base | `a27b7e0` | **Slice 26:** Controller dinâmico, `skills-loader` v2 (`agentskills.io`), Playbooks Sênior, `WorkingMemory`, `SemanticRecall`, `PromptInjectionGuardProcessor` | `pnpm verify` 34/34 + `factory-verifier` PASS |
| 1 | `ff08845` | **Contratos Zod Consolidados (Slices 27–34):** `role-tools.ts`, `handoffs-v2.ts`, `agent-evals.ts`, `security-v2.ts`, `governance-v2.ts`, `index.ts` | `@uzina/contracts` build + **14 files, 269 tests passed** |
| 2 | `4cf36b1` | **Slice 27:** 16 skills autorais `Apache-2.0` (8 evoluídas + 8 novas) + `references/`, `templates/`, `scripts/check-migration-ddl.mjs` + integridade | `@uzina/core` build + **2 files, 34 tests passed** |
| 3 | `4b3ea02` | **Slice 28:** 14 tools especializadas com RBAC/multi-tenant, `ToolSearchProcessor`, `review` read-only e `selectNonConflictingSkillsForStage` | `@uzina/mastra-runtime` build + **2 files, 49 tests passed** |
| 4 | `0961fee` | **Slice 33 (AppSec v2):** DAST passivo + Nuclei, SCA Reachability, SBOM CycloneDX 1.5, `scanAgenticPromptInjectionNative` | `@uzina/security-engine` build + **1 file, 14 tests passed** |
| 5 | `769d943` | **Slice 29:** `ShapeSpec`, `ArchitectBlueprintV2`, pipeline UX 3 estágios (`PrototypeComponentManifest`) e `agency.ts` LLM + fallback | `slice29-structured-handoffs`: **8/8 passed** |
| 6 | `36fe585` | **Slice 30:** `migration-safety.ts`, 3-Strikes (`stuck-detector.ts` + `runner.ts`), `Test Lock` + micro-loop allowlisted (`workspace-adapter.ts`) | `@uzina/core` **220/220**, `@uzina/opencode-bridge` **58/58**, `slice30` **28/28** |
| 7 | `71cad82` | **Slice 31 (Backend/Workflow/PR) + Wiring Onda 2:** `two-stage-verifier.ts`, `github-pr.ts` Risk Briefing, retro QMD, `syncOpenSpecArchive`, wiring completo em `deliverable-lifecycle.ts` | `slice31` **9/9**, `slice19` **8/8**, `check-no-ee` **0**, `audit-tests` **91 arq / 322 testes / 0 violações** |
| 8 | *(HEAD atual)* | **Documentação de Checkpoint:** Dossiês 27–31 & 33, `ROADMAP_STATUS.md`, `PROGRESS_LOG.md`, `slices-checklist.md` e este guia de handoff | `check-no-ee` **0**, árvore limpa |

---

## 2. O Que Resta Implementar (Onda 3 + Onda 4)

> **ATENÇÃO — NÃO RECRIAR CONTRATOS ZOD:**  
> Todos os schemas dos Slices 31, 32 e 34 **já existem e já compilam** em:  
> - `packages/contracts/src/handoffs-v2.ts` (`SpecComplianceRowSchema`, `VerifierTwoStageOutputSchema`, `DecisionRiskBriefingSchema`)  
> - `packages/contracts/src/agent-evals.ts` (`AgentTrajectoryEvalCaseSchema`, `AgentTrajectoryEvalResultSchema`, `AgentTrajectoryEvalReportSchema`, `AgentEffectivenessMetricsSchema`)  
> - `packages/contracts/src/governance-v2.ts` (`VisualA11yVerifyReportSchema`, `SkillsLockEntrySchema`, `SkillsLockManifestSchema`, `EntropyAuditReportSchema`, `MutationPbtReportSchema`)

### Onda 3 — 3 Frentes 100% Disjuntas (Prontas para Paralelismo)

1. **Frente A — Slice 32 Backend & CI (`runtime-worker`)**
   - **Arquivos exclusivos:**
     - `packages/mastra-runtime/src/evals/trajectory-evals.ts` *(novo)* — suíte determinística zero-LLM (`runTrajectoryEvalSuite()`) validando gates binários (`calledRequiredTools`, `forbiddenToolsCalled`, `noToolErrors`, `toolOrderRespected`, `testLockRespected`, `specTraceabilityComplete`, `budgetWithinCap`) para `software_architect`, `ux_designer`, `qa_appsec` e `MastraWorkspaceExecutorAdapter`.
     - `packages/mastra-runtime/src/finops.ts` — exportar `computeAgentEffectivenessMetricsScoped({ db, organizationId, projectId? })` retornando `AgentEffectivenessMetrics` real de `executionEvents` & `deliverables`. *(Nota: `finops.ts` já é re-exportado em `packages/mastra-runtime/src/index.ts`, portanto esta frente NÃO edita `index.ts` para evitar colisão com a Frente B.)*
     - `scripts/audit-agent-trajectories.mjs` *(novo)* — importa `packages/mastra-runtime/dist/evals/trajectory-evals.js`, executa `runTrajectoryEvalSuite()`, imprime resumo e sai com `0` ou `1`.
     - `packages/mastra-runtime/tests/slice32-trajectory-evals.test.ts` *(novo)* — testa gates positivos/negativos e cálculo real em PGlite `:memory:`.

2. **Frente B — Slice 34 Core, Runtime, CLI & Hook A11y (`contracts-core`)**
   - **Arquivos exclusivos:**
     - `packages/core/src/skills-lock.ts` *(novo)* — `generateSkillsLockManifest` e `verifySkillsLockManifest` (SHA-256 determinístico em `SKILL.md` + recursos ordenados + checagem de licença `Apache-2.0`/`MIT`).
     - `packages/core/src/mutation-pbt.ts` *(novo)* — adaptador opcional Stryker (`execFile`, `shell: false`, `skipped_missing_binary`) + helpers determinísticos de PBT para schemas Zod (sem novas deps pesadas).
     - `packages/core/src/index.ts` — re-exportar `./skills-lock.js` e `./mutation-pbt.js`.
     - `packages/mastra-runtime/src/stages/visual-a11y-verify.ts` *(novo)* — `runVisualA11yVerify` nos viewports `1440x900` e `390x844` (overflow horizontal, console errors, violações axe `critical`/`serious`), com runner injetável para testes e degradação `skipped_missing_binary`.
     - `packages/mastra-runtime/src/entropy.ts` *(novo)* — `runEntropyAudit` (worktrees órfãos, referências de spec inexistentes, símbolos exportados sem chamadores excluindo entrypoints).
     - `packages/mastra-runtime/src/workflows/deliverable-lifecycle.ts` — hook opcional chamando `runVisualA11yVerify` em `stageVerify` quando `hasUi === true` e preview URL/comando configurado.
     - `packages/mastra-runtime/src/index.ts` — re-exportar `./stages/visual-a11y-verify.js` e `./entropy.js`.
     - `apps/cli/src/cli.ts` e `apps/cli/src/index.ts` — adicionar `uzina doctor --entropy`.
     - `packages/core/tests/slice34-skills-lock-entropy.test.ts` *(novo)* e `packages/mastra-runtime/tests/slice34-visual-a11y-verify.test.ts` *(novo)*.

3. **Frente C — UI Consolidada em `apps/web/` para Slices 31, 32 e 34 (`appsec-worker`)**
   - **Arquivos exclusivos:** `apps/web/**` (seguir `.uzina/DESIGN.md`, Warm Stone OKLCH, `tabular-nums`, 5 estados, mobile `390px` zero overflow, RBAC + `organizationId` server-side em toda rota nova).
   - **Entregas:**
     1. **Slice 31 UI (`/app/decisions`):** `apps/web/src/components/decision-risk-briefing-card.tsx` integrado a `decisions-workbench.tsx` (Matriz Requisito ↔ Teste ↔ Diff, Confidence Score `0–100`, Checklist de Risco & Rollback).
     2. **Slice 32 UI (`/app/finops`):** rota `GET /api/finops/effectiveness` + `apps/web/src/components/agent-effectiveness-panel.tsx` integrado a `finops-dashboard.tsx`.
     3. **Slice 34 UI (`/app/finops`):** rotas `GET /api/skills/catalog` e `GET /api/projects/[id]/entropy` + `apps/web/src/components/skills-catalog-panel.tsx` integrado a `finops-dashboard.tsx`.
     4. **Testes:** `apps/web/tests/slices-31-32-34-ui.test.ts` (não inflar `contract-drift.test.ts`).

### Onda 4 — Verificação Final Única, Auditoria, Dossiês & PR
1. Rodar **1 única vez**:
   - `node scripts/check-no-ee.mjs`
   - `pnpm verify` (build completo + Next.js + `audit-tests` + typecheck + lint + todos os testes)
   - `node scripts/audit-agent-trajectories.mjs`
   - Auditoria de segurança/qualidade consolidada sobre `git diff main..HEAD` (`appsec-auditor` + `factory-verifier`).
   - Se houver ambiente de UI/browser ativo, validar `/app/decisions` e `/app/finops` em `1440x900` e `390x844` + `pnpm test:e2e`.
2. Commits semânticos `feat(slice-32)` e `feat(slice-34)` (+ complementação `feat(slice-31)` para a UI ou incluída em commit próprio).
3. Criar `docs/slices/slice-32-agentic-ci-evals-trajectory-gates.md` e `docs/slices/slice-34-visual-a11y-mutation-pbt-and-skills-registry.md`, atualizar `slice-31` para `Concluído`, atualizar `ROADMAP_STATUS.md`, `PROGRESS_LOG.md`, `.uzina/slices-checklist.md` e o bloco de status em `docs/planos/dossie-agentes-por-fase-v2.md`.
4. Commit final de documentação, `git push -u origin feat/slices-27-34-agentic-evolution-v2` e abertura da Pull Request para `main`.

---

## 3. Como Retomar no Novo Ambiente

```powershell
# 1. Clonar/atualizar e entrar na branch exata
git fetch origin
git checkout feat/slices-27-34-agentic-evolution-v2
git pull origin feat/slices-27-34-agentic-evolution-v2

# 2. Instalar dependências exatamente como no lockfile
pnpm install --frozen-lockfile

# 3. Conferir estado rápido
node scripts/check-no-ee.mjs; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git log -n 8 --oneline
```

**Prompt pronto para colar no novo ambiente:**
> `/swarm Leia docs/status/HANDOFF_CONTINUACAO_ONDA3_SLICES_31_32_34.md e docs/planos/plano-mestre-evolucao-agentes-v2-slices-26-34.md. As Ondas 0, 1 e 2 (contratos 28-34 e Slices 27, 28, 29, 30, 31-backend e 33) já estão concluídas e commitadas na branch feat/slices-27-34-agentic-evolution-v2. Execute a Onda 3 em paralelo (Frente A Slice 32, Frente B Slice 34, Frente C UI 31/32/34 em apps/web) e depois a Onda 4 (pnpm verify único, audit-agent-trajectories, auditoria consolidada, atualização final dos dossiês 31/32/34 + dossie-agentes-por-fase-v2.md, commit e push).`
