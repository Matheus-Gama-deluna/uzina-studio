# Dossiê do Slice 28 — Desbloqueio de 14 Tools Especializadas por Papel, RBAC & Orquestração Anti-Conflito

* **Status:** `Concluído`
* **Branch:** `feat/slices-27-34-agentic-evolution-v2` (commit `4b3ea02`, após contratos `ff08845`)
* **Estratégia Aplicada:** *Contract-First (`@uzina/contracts`) + Princípio de Menor Privilégio + PGlite em Memória*
* **Spec de Referência:** [plano-mestre-evolucao-agentes-v2-slices-26-34.md](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/docs/planos/plano-mestre-evolucao-agentes-v2-slices-26-34.md)

---

## 1. Objetivo e Escopo Estrito
Resolve **GAP-03** e **GAP-04**, expondo aos 6 especialistas, ao `UzinaAgentController` e ao `Executive Copilot` 14 tools tipadas com Zod, isoladas por `organizationId` / posse de `projectId`, protegidas por RBAC (`OrgRole`) fail-closed, contenção de path traversal e redação automática de segredos.

---

## 2. Entregas Realizadas (`ff08845` + `4b3ea02`)
- **Contratos (`@uzina/contracts`):** [role-tools.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/contracts/src/role-tools.ts) com schemas input/output e paginação/limites de bytes das 14 tools.
- **14 Tools Especializadas em [role-specialized-tools.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/tools/role-specialized-tools.ts) e [workspace-tools.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/tools/workspace-tools.ts):**
  - *Inteligência de Código (`software_architect`, `tech_lead`, `qa_appsec`):* `trace_symbol_call_graph`, `analyze_change_impact`, `read_symbol_source_slice` (bloqueando `.env`, `.master-key`, symlinks e traversal), `check_dependency_boundaries`.
  - *Produto & Executivo (`product_discovery`, `Executive Copilot`, `orchestrator`):* `check_requirement_conflicts`, `read_finops_and_risk_digest`.
  - *Design & UX (`ux_designer`):* `read_design_system_contract`, `inspect_prototype_version`, `validate_color_contrast_and_tokens` (cálculo real WCAG 2.1 de luminância relativa para hex e OKLCH).
  - *QA & AppSec (`qa_appsec`):* `read_security_scan_findings`, `read_deliverable_evidence_and_diff`, `run_test_anti_pattern_audit`.
  - *Coordenação (`orchestrator`):* `inspect_worktrees_and_locks`, `distill_retrospective_memory` (restrito a `WRITE_ROLES`).
- **Controller, Agentes & Processors:**
  - [controller.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/controller.ts): mapeamento de menor privilégio em `CONTROLLER_MODE_TOOLS` (`review` estritamente read-only) e `ToolSearchProcessor` ativo quando o agente possui `>= 8` tools.
  - [engineering-agents.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/agents/engineering-agents.ts) e [executive-copilot.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/agents/executive-copilot.ts): binding das tools por papel e ativação de `ToolSearchProcessor`.
  - [processors.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/processors.ts): integração de `selectNonConflictingSkillsForStage` dentro de `createUzinaSkillsCatalogProcessor`.
- **Testes:** [slice28-workspace-tools-rbac.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/tests/slice28-workspace-tools-rbac.test.ts) (PGlite `:memory:`, isolamento multi-tenant, RBAC `auditor`, cálculo WCAG hex/OKLCH e contenção de `.env`/`.master-key`).

---

## 3. Evidências de Verificação
- `pnpm --filter @uzina/contracts build && test`: **14 files, 269 tests passed** (`ff08845`)
- `pnpm --filter @uzina/mastra-runtime build`: **PASS**
- `pnpm --filter @uzina/mastra-runtime test -- tests/slice28-workspace-tools-rbac.test.ts tests/slice26-controller-memory-skills.integration.test.ts`: **2 files, 49 tests passed**
- `node scripts/check-no-ee.mjs`: **exit 0** | `node scripts/audit-tests.mjs`: **0 violações**
- *Pendente apenas:* inclusão na validação consolidada `pnpm verify` global na Onda 4.
