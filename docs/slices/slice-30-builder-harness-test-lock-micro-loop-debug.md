# Dossiê do Slice 30 — Builder Harness: Test Lock, Micro-Loop Allowlisted, Migration Safety & 3-Strikes

* **Status:** `Concluído`
* **Branch:** `feat/slices-27-34-agentic-evolution-v2` (commit `36fe585` + wiring workflow em `71cad82`)
* **Estratégia Aplicada:** *Harness Engineering (`Test Lock` anti-reward-hacking + `execFile` allowlisted + `3-Strikes`)*
* **Spec de Referência:** [plano-mestre-evolucao-agentes-v2-slices-26-34.md](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/docs/planos/plano-mestre-evolucao-agentes-v2-slices-26-34.md)

---

## 1. Objetivo e Escopo Estrito
Resolve **GAP-06**, blindando a fase de execução (`stageContractAndTests` e `stageBuild`) contra *reward hacking* nos testes contratuais, fornecendo verificação rápida allowlisted dentro do worktree e impondo depuração científica com escalação após 3 falhas consecutivas.

---

## 2. Entregas Realizadas (`ff08845` + `36fe585` + wiring `71cad82`)
- **Contratos (`@uzina/contracts`):** `ScopedCheckResultSchema`, `MigrationSafetyIssueSchema`, `MigrationSafetyReportSchema` e `StuckAlertV2ExtensionSchema` em [handoffs-v2.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/contracts/src/handoffs-v2.ts).
- **Analisador de Segurança de Migrações:** [migration-safety.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/core/src/migration-safety.ts) (`validateMigrationSafety`) detectando `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `ADD COLUMN ... NOT NULL` sem `DEFAULT`, `ALTER COLUMN TYPE` inseguro e `CREATE INDEX` sem `CONCURRENTLY`.
- **Depuração Científica 3-Strikes:** [stuck-detector.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/core/src/stuck-detector.ts) e [runner.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/opencode-bridge/src/runner.ts) (`onThreeStrikeDirective`, exigência de hipótese de causa-raiz na 2ª falha idêntica consecutiva e escalação `StuckAlert` com `strikeCount: 3`, `escalatedToArchitect: true` na 3ª).
- **Test Lock & Micro-Loop Allowlisted:** [workspace-adapter.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/workspace-adapter.ts):
  - `lockedReadOnlyPaths` em `CodingAdapterExecutionOptions` bloqueando no `beforeToolCall` mutações (`WRITE_FILE`, `EDIT_FILE`, `AST_EDIT`, `DELETE`, `APPLY_PATCH`) sobre testes contratuais travados.
  - Tools `run_scoped_typecheck`, `run_scoped_unit_test` (via `execFile` com `shell: false`, timeout `<= 30s`, allowlist fechada sem `..`/flags arbitrárias e respeito a `toolPolicies.runTests`: `allow | ask | deny`) e `validate_migration_safety`.
- **Wiring Workflow:** `stageContractAndTests` recebe `PrototypeComponentManifest` + `storyShards`; `stageBuild` aplica `contractTestFiles` em `lockedReadOnlyPaths` e inclui passada de simplificação de diff em [deliverable-lifecycle.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/workflows/deliverable-lifecycle.ts).
- **Testes:** [slice30-builder-harness.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/tests/slice30-builder-harness.test.ts).

---

## 3. Evidências de Verificação
- `pnpm --filter @uzina/core build && test`: **16 files, 220 tests passed**
- `pnpm --filter @uzina/opencode-bridge build && test`: **6 files, 58 tests passed**
- `pnpm --filter @uzina/mastra-runtime build && test -- tests/slice30-builder-harness.test.ts`: **28/28 passed**
- `node scripts/audit-tests.mjs`: **0 violações**
- *Pendente apenas:* `appsec-auditor` focado no `execFile` e validação consolidada `pnpm verify` global na Onda 4.
