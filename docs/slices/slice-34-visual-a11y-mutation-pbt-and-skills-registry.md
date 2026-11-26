# Dossiê do Slice 34 — QA Visual A11y, Mutation/PBT, `skills-lock.json` & Auditoria de Entropia

* **Status:** `Concluído`
* **Branch:** `feat/slices-27-34-agentic-evolution-v2` (commit `c0ac693`, após contratos `ff08845`)
* **Estratégia Aplicada:** *Supply-Chain Skills Lock + Deterministic PBT/Stryker + Multi-Viewport A11y Gate + Entropy Governance*
* **Spec de Referência:** [plano-mestre-evolucao-agentes-v2-slices-26-34.md](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/docs/planos/plano-mestre-evolucao-agentes-v2-slices-26-34.md)

---

## 1. Objetivo e Escopo Estrito
Fecha a Evolução Agêntica v2 adicionando verificação determinística de cadeia de suprimentos das skills (`skills-lock.json` com SHA-256 e política de licença), utilitários de Property-Based Testing e adaptador Stryker, portão visual/acessibilidade (`1440x900` e `390x844`) em `stageVerify`, auditoria de entropia arquitetural via CLI e visibilidade operacional no painel `/app/finops`.

---

## 2. Entregas Realizadas (`ff08845` + `c0ac693`)
- **Contratos (`@uzina/contracts`):** `VisualA11yVerifyReportSchema`, `SkillsLockEntrySchema`, `SkillsLockManifestSchema`, `EntropyAuditReportSchema` e `MutationPbtReportSchema` em [governance-v2.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/contracts/src/governance-v2.ts).
- **Supply-Chain de Skills (`@uzina/core`):** [skills-lock.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/core/src/skills-lock.ts) (`computeSkillDirectorySha256`, `generateSkillsLockManifest`, `verifySkillsLockManifest`, `readSkillsLockFile`, `writeSkillsLockFile`) com contenção `assertPathInsideWorkspace`, hash SHA-256 determinístico e exigência de licença `Apache-2.0`/`MIT`.
- **PBT Determinístico & Mutation Testing (`@uzina/core`):** [mutation-pbt.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/core/src/mutation-pbt.ts) (`createSeededRng`, `createZodArbitraryHelpers`, `runDeterministicPropertyCheck`, `runSchemaRoundTripProperty` e `runScopedMutationAndPbt` com Stryker via `execFile`, `shell: false`, allowlist e degradação `skipped_missing_binary`).
- **Portão Visual & A11y (`@uzina/mastra-runtime`):** [visual-a11y-verify.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/stages/visual-a11y-verify.ts) (`runVisualA11yVerify`) avaliando Desktop `1440x900` e Mobile `390x844` (overflow horizontal, `console.error`, violações axe `critical`/`serious`), com runner injetável e fallback `skipped_missing_binary`, conectado ao `stageVerify` em [deliverable-lifecycle.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/workflows/deliverable-lifecycle.ts) quando `hasUi === true`.
- **Auditoria de Entropia & CLI (`@uzina/mastra-runtime` + `apps/cli`):** [entropy.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/entropy.ts) (`runEntropyAudit`) detectando worktrees órfãos, drift de referências em specs, código morto (excluindo entrypoints) e dependências não usadas; exposto em `uzina doctor --entropy [--root <dir>]` via [cli.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/cli/src/cli.ts).
- **APIs, MSW & UI `/app/finops` (`apps/web`):** [route.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/src/app/api/skills/catalog/route.ts) (`GET /api/skills/catalog`), [route.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/src/app/api/projects/[id]/entropy/route.ts) (`GET /api/projects/[id]/entropy` com RBAC e multi-tenant), [skills-catalog-panel.tsx](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/src/components/skills-catalog-panel.tsx) integrado ao [finops-dashboard.tsx](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/src/components/finops-dashboard.tsx), fixtures e handlers em [fixtures.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/src/mocks/fixtures.ts) e [handlers.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/src/mocks/handlers.ts).
- **Testes:** [slice34-skills-lock-entropy.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/core/tests/slice34-skills-lock-entropy.test.ts), [slice34-visual-a11y-verify.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/tests/slice34-visual-a11y-verify.test.ts) e [slices-31-32-34-ui.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/tests/slices-31-32-34-ui.test.ts).

---

## 3. Evidências de Verificação (Onda 4A)
- `pnpm verify`: **34/34 tasks OK** (9/9 builds, 9/9 typechecks, 9/9 lints; `@uzina/core` 17 files / 228 passed; `@uzina/mastra-runtime` 24 files / 183 passed; `@uzina/cli` 1 file / 13 passed; `@uzina/web` 15 files / 45 passed).
- `node scripts/check-no-ee.mjs`: **exit 0** | `node scripts/audit-tests.mjs`: **95 arquivos, 338 testes, 2 suprimidos, 0 violações**.
- `node scripts/audit-agent-trajectories.mjs`: **4/4 passed**.
