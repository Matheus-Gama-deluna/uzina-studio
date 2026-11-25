# Dossiê do Slice 32 — CI Evals de Trajetória & Painel de Efetividade Agêntica

* **Status:** `Concluído`
* **Branch:** `feat/slices-27-34-agentic-evolution-v2` (commit `8475fcd`, após contratos `ff08845`)
* **Estratégia Aplicada:** *Zero-LLM Deterministic Trajectory Evals + FinOps Effectiveness Telemetry*
* **Spec de Referência:** [plano-mestre-evolucao-agentes-v2-slices-26-34.md](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/docs/planos/plano-mestre-evolucao-agentes-v2-slices-26-34.md)

---

## 1. Objetivo e Escopo Estrito
Elimina a cegueira sobre regressões comportamentais de prompts, tools e harness ao introduzir uma suíte determinística de **Evals de Trajetória** executada no CI sem depender de chaves de LLM externas, além de métricas reais de efetividade por papel agêntico em `/app/finops`.

---

## 2. Entregas Realizadas (`ff08845` + `8475fcd`)
- **Contratos (`@uzina/contracts`):** `AgentTrajectoryEvalCaseSchema`, `AgentTrajectoryEvalResultSchema`, `AgentTrajectoryEvalReportSchema` e `AgentEffectivenessMetricsSchema` em [agent-evals.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/contracts/src/agent-evals.ts).
- **Motor de Trajectory Evals (`@uzina/mastra-runtime`):** [trajectory-evals.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/evals/trajectory-evals.ts) expondo `evaluateAgentTrajectory` (7 portões binários: `calledRequiredTools`, `forbiddenToolsCalled`, `noToolErrors`, `toolOrderRespected`, `testLockRespected`, `specTraceabilityComplete`, `budgetWithinCap`) e `runTrajectoryEvalSuite()` cobrindo `software_architect`, `ux_designer`, `qa_appsec` e execução real em workspace temporário do `MastraWorkspaceExecutorAdapter` (read-before-edit e `lockedReadOnlyPaths`).
- **Telemetria de Efetividade por Papel:** `computeAgentEffectivenessMetricsScoped({ db, organizationId, projectId? })` em [finops.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/finops.ts) calculando `firstPassVerifyRate`, `averageVerifyAttempts`, `skillAdherenceRate`, `averageConfidenceScore`, `reworkCostUsd` e detalhamento `byRole` sobre `execution_events` e `deliverables`.
- **Gate CI Determinístico:** [audit-agent-trajectories.mjs](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/scripts/audit-agent-trajectories.mjs) importando o bundle compilado de `@uzina/mastra-runtime` e falhando o build caso qualquer caso de trajetória regrida.
- **API & UI `/app/finops` (`apps/web`):** rota autenticada [route.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/src/app/api/finops/effectiveness/route.ts) (RBAC + escopo `organizationId`/`projectId`) e componente [agent-effectiveness-panel.tsx](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/src/components/agent-effectiveness-panel.tsx) integrado ao [finops-dashboard.tsx](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/src/components/finops-dashboard.tsx) com MSW e testes.
- **Testes:** [slice32-trajectory-evals.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/tests/slice32-trajectory-evals.test.ts) (PGlite `:memory:` + `test.each` para portões binários negativos), atualização de [slice18-real-agents-om.integration.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/tests/slice18-real-agents-om.integration.test.ts) (`ToolSearchProcessor`) e [slices-31-32-34-ui.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/tests/slices-31-32-34-ui.test.ts).

---

## 3. Evidências de Verificação (Onda 4A)
- `node scripts/audit-agent-trajectories.mjs`: **4/4 passed** (`architect`, `ux_designer`, `qa_appsec`, `tech_lead` harness).
- `pnpm verify`: **34/34 tasks OK** (`@uzina/mastra-runtime`: 24 files / 183 passed; `@uzina/web`: 15 files / 45 passed).
- `node scripts/check-no-ee.mjs`: **exit 0** | `node scripts/audit-tests.mjs`: **95 arquivos, 338 testes, 2 suprimidos, 0 violações**.
