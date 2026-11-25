# Dossiê do Slice 31 — Two-Stage Verifier, Risk Briefing, Retrospectiva QMD & OpenSpec Sync

* **Status:** `Concluído`
* **Branch:** `feat/slices-27-34-agentic-evolution-v2` (commits `71cad82` Backend/Workflow + `b5faf27` UI `/app/decisions`, após contratos `ff08845`)
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
- **UI `/app/decisions` (`apps/web`, commit `b5faf27`):** [decision-risk-briefing-card.tsx](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/src/components/decision-risk-briefing-card.tsx) integrado ao [decisions-workbench.tsx](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/src/components/decisions-workbench.tsx) exibindo Matriz Requisito ↔ Teste ↔ Diff, `Confidence Score (0–100)`, Checklist de Superfície Alterada e Plano de Rollback nos 5 estados de UI (`loading`, `empty`, `error`, `partial`, `populated`).
- **Testes:** [slice31-two-stage-verifier-retro.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/tests/slice31-two-stage-verifier-retro.test.ts) (PGlite `:memory:`) e [slices-31-32-34-ui.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/tests/slices-31-32-34-ui.test.ts).

---

## 3. Evidências de Verificação (Onda 4A)
- `pnpm verify`: **34/34 tasks OK** (9/9 builds, 9/9 typechecks, 9/9 lints; `@uzina/mastra-runtime` 24 files / 183 passed; `@uzina/web` 15 files / 45 passed).
- `node scripts/check-no-ee.mjs`: **exit 0** | `node scripts/audit-tests.mjs`: **95 arquivos, 338 testes, 2 suprimidos, 0 violações**.
- `node scripts/audit-agent-trajectories.mjs`: **4/4 passed**.
