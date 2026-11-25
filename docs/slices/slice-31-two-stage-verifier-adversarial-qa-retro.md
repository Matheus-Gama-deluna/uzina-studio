# Dossiê do Slice 31 — Two-Stage Verifier, Risk Briefing, Retrospectiva QMD & OpenSpec Sync

* **Status:** `Backend/Workflow Concluído · UI pendente na Onda 3`
* **Branch:** `feat/slices-27-34-agentic-evolution-v2` (commit `71cad82`, após contratos `ff08845`)
* **Estratégia Aplicada:** *Fresh-Context Two-Stage Verifier (`Spec Compliance` → `Adversarial QA/AppSec`) + Determinismo no Risk Briefing*
* **Spec de Referência:** [plano-mestre-evolucao-agentes-v2-slices-26-34.md](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/docs/planos/plano-mestre-evolucao-agentes-v2-slices-26-34.md)

---

## 1. Objetivo e Escopo Estrito
Resolve **GAP-07**, elevando `stageVerify`, `stageDecision` e `stageFinalize` com verificação em dois estágios em contexto limpo, cálculo determinístico de `DecisionRiskBriefing`, gravação automática de aprendizados no QMD e sincronização de `OPENSPEC.md` pós-merge.

---

## 2. Entregas Realizadas (`ff08845` + `71cad82`)
- **Contratos (`@uzina/contracts`):** `SpecComplianceRowSchema`, `VerifierTwoStageOutputSchema` e `DecisionRiskBriefingSchema` em [handoffs-v2.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/contracts/src/handoffs-v2.ts).
- **Motor de Verificação, Risco & Retrospectiva em [two-stage-verifier.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/stages/two-stage-verifier.ts):**
  - `evaluateTwoStageVerifier`: Estágio 1 (`stage1SpecCompliance` com short-circuit se qualquer critério estiver `missing`/`divergent`) → Estágio 2 (`stage2QualityAndSecurity` adversarial com *Refuting Verifier* e *survivingMutantRisks`) + `confidenceScore` (`0..100`).
  - `computeDecisionRiskBriefing`: detecção determinística de `dbMigrations`, `authOrRbac`, `cryptoOrSecrets`, `newDependencies`, `newEnvVars`, cálculo de `riskLevel`, plano de rollback e resumo FinOps.
  - `distillRetrospectiveToQmd`: grava lições estruturadas no QMD (`convention` / `security_triage`) quando `verifyAttempts >= 2` ou há rejeição/`changes_requested` humana com feedback.
  - `syncOpenSpecArchive`: aplica `openSpecDelta` (`added`/`modified`/`removed`) ao documento vivo `OPENSPEC.md` no `merged` (removendo placeholders vazios).
- **Draft PR & Workflow:** [github-pr.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/github-pr.ts) renderiza `DecisionRiskBriefing` no corpo do Draft PR; [deliverable-lifecycle.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/workflows/deliverable-lifecycle.ts) conecta `stageVerify`, `stageDecision` e `stageFinalize`.
- **Testes:** [slice31-two-stage-verifier-retro.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/tests/slice31-two-stage-verifier-retro.test.ts) (PGlite `:memory:`).

## 3. Pendências para Fechamento Completo (Onda 3)
- [ ] **UI `/app/decisions` (`apps/web/`):** `DecisionRiskBriefingCard` em `decisions-workbench.tsx` exibindo Matriz Requisito ↔ Teste ↔ Diff, `Confidence Score (0–100)` e Checklist de Risco & Rollback + testes/QA `browser`.

---

## 4. Evidências de Verificação (Backend/Workflow)
- `pnpm --filter @uzina/mastra-runtime build`: **PASS**
- `pnpm --filter @uzina/mastra-runtime test -- tests/slice31-two-stage-verifier-retro.test.ts`: **9/9 passed**
- `node scripts/check-no-ee.mjs`: **exit 0** | `node scripts/audit-tests.mjs`: **91 arquivos, 322 testes, 0 violações**
