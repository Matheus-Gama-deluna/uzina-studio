# Dossiê do Slice 29 — Handoffs Estruturados (Fases 1, 2 e 2.5) & Pipeline Visual em 3 Estágios

* **Status:** `Concluído`
* **Branch:** `feat/slices-27-34-agentic-evolution-v2` (commit `769d943` + wiring workflow em `71cad82`)
* **Estratégia Aplicada:** *Contract-First (`handoffs-v2.ts`) + Invariante Upstream→Downstream + Pipeline UX 3 Estágios*
* **Spec de Referência:** [plano-mestre-evolucao-agentes-v2-slices-26-34.md](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/docs/planos/plano-mestre-evolucao-agentes-v2-slices-26-34.md)

---

## 1. Objetivo e Escopo Estrito
Resolve **GAP-05**, implantando artefatos contratuais imutáveis entre as Fases 1 (Discovery), 2 (Arquitetura) e 2.5 (Estúdio Visual), reduzindo decisões cegas por regex para **Structured Output via LLM** com fallback determinístico offline resiliente.

---

## 2. Entregas Realizadas (`ff08845` + `769d943` + wiring `71cad82`)
- **Contratos (`@uzina/contracts`):** `ShapeSpecSchema`, `ArchitectBlueprintV2Schema` e `PrototypeComponentManifestSchema` em [handoffs-v2.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/contracts/src/handoffs-v2.ts).
- **Orquestração de Estágios em [structured-handoffs.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/stages/structured-handoffs.ts):**
  - `validateAndBuildShapeSpec`: aplica *Ambiguity Gate* e exige `nonGoals` (mínimo 1) + cenários BDD/RBAC.
  - `generateArchitectBlueprintV2`: gera ADR, matriz STRIDE/FMEA, `storyShards`, detecta colisões de símbolos via AST/`SymbolLockManager` (marcando `sequential: true`) e produz `openSpecDelta` para projetos Brownfield.
  - `runVisualStudioThreeStagePipeline`: executa **Lead (`visual-design-md`) → Reference (`packages/ui`) → Fresh-Context Critique (`ui-design-critique-a11y`)**, reprovando ausência dos 5 estados (`loading`, `empty`, `error`, `partial`, `populated`) ou falha WCAG, e gerando `PrototypeComponentManifestSchema`.
- **Agency (`LLM + Fallback`):** [agency.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/agency.ts) adiciona `decideOptimalAiStrategyWithAgent` (fallback determinístico `decideOptimalAiStrategy`) e `buildVisualPrototypeBlueprintWithAgent` (fallback `inferDomainVisualBlueprint`).
- **Wiring Workflow:** conectado às etapas `stageDiscovery`, `stageBlueprint` e `stageVisualStudio` em [deliverable-lifecycle.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/workflows/deliverable-lifecycle.ts) mantendo compatibilidade retroativa com `service.ts` e `slice19`.
- **Testes:** [slice29-structured-handoffs.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/tests/slice29-structured-handoffs.test.ts).

---

## 3. Evidências de Verificação
- `pnpm --filter @uzina/mastra-runtime build`: **PASS**
- `pnpm --filter @uzina/mastra-runtime test -- tests/slice29-structured-handoffs.test.ts tests/slice19-controller-workflow-bridge.integration.test.ts`: **8/8** (`slice29`) + **8/8** (`slice19`) **passed**
- `node scripts/audit-tests.mjs`: **0 violações**
- *Pendente apenas:* inclusão na validação consolidada `pnpm verify` global na Onda 4.
