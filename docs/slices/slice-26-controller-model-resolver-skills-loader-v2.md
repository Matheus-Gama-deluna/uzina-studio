# Dossiê do Slice 26 — Controller Dinâmico, SkillsLoader v2 (`agentskills.io`), Playbooks & Memória/Guardrails

* **Status:** `Concluído`
* **Branch:** `fix/slice-26-controller-model-resolver-skills-loader-v2`
* **Estratégia Aplicada:** *Contract-First (`@uzina/contracts`) + TDD Estrito (`RED → GREEN → REFACTOR`) + PGlite/LibSQL em Memória*
* **Spec de Referência:** [plano-mestre-evolucao-agentes-v2-slices-26-34.md](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/docs/planos/plano-mestre-evolucao-agentes-v2-slices-26-34.md) & [dossie-agentes-por-fase-v2.md](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/docs/planos/dossie-agentes-por-fase-v2.md)

---

## 1. Objetivo e Escopo Estrito
Resolve **BUG-01**, **BUG-02/GAP-01**, **GAP-02 (loader)** e **GAP-09**:
- Remover o modelo hardcoded `"openai/gpt-4o-mini"` do `UzinaAgentController` (`controller.ts`) passando a resolver dinamicamente via `createTenantModelResolver` por organização e modo (`discovery`, `architect`, `visual`, `build`, `review`).
- Evoluir `packages/core/src/skills-loader.ts` para o padrão `agentskills.io` (descoberta de `references/`, `templates/`, `scripts/`, cálculo/validação de orçamentos, `loadSkillResource` com contenção estrita e `selectNonConflictingSkillsForStage`).
- Substituir `ROLE_INSTRUCTIONS` rasas em `engineering-agents.ts` por **Playbooks Sênior** com restrições negativas + catálogo progressivo de skills + tool sob demanda `load_uzina_skill`.
- Habilitar `WorkingMemory` tipada (`AgencyWorkingMemorySchema`), `SemanticRecall` multi-tenant via QMD e `PromptInjectionGuardProcessor` (+ suporte opcional a `PromptInjectionDetector` do Mastra) em `memory-runtime.ts` e `processors.ts`.

**Fora de escopo neste Slice:** reescrita do conteúdo das 8 skills e criação das 8 novas skills (Slice 27), exposição das 14 tools novas de AST/UX/AppSec/FinOps (Slice 28), structured handoffs das Fases 1–2.5 (Slice 29), Test Lock/micro-loop (Slice 30) e Two-Stage Verifier (Slice 31).

---

## 2. Fronteiras de Pacotes e Arquivos Previstos
- `@uzina/contracts`: `packages/contracts/src/execution.ts`, `packages/contracts/src/agency.ts`
- `@uzina/core`: `packages/core/src/skills-loader.ts`, `packages/core/src/index.ts`, `packages/core/tests/slice26-skills-loader-v2.test.ts`
- `@uzina/mastra-runtime`: `packages/mastra-runtime/src/processors.ts`, `packages/mastra-runtime/src/tools/workspace-tools.ts`, `packages/mastra-runtime/src/agents/engineering-agents.ts`, `packages/mastra-runtime/src/controller.ts`, `packages/mastra-runtime/src/memory-runtime.ts`, `packages/mastra-runtime/src/index.ts`, `packages/mastra-runtime/tests/slice26-controller-memory-skills.integration.test.ts`

---

## 3. Contratos Compartilhados (`@uzina/contracts`)
- `SkillLifecyclePhaseSchema`, `SkillRoleCategorySchema`, `SkillBudgetMetricsSchema` e extensão retrocompatível de `SkillDefinitionSchema`.
- `AgencyWorkingMemorySchema` para memória tática estruturada por `resourceId`.

---

## 4. Persistência, Segurança e Decisões Técnicas
- Zero módulos `ee/` (`node scripts/check-no-ee.mjs` = `0`).
- `loadSkillResource` permite apenas `references/`, `templates/` ou `scripts/`, valida via `assertPathInsideWorkspace` + `lstatSync` (rejeita symlinks/null-bytes/traversal/arquivos sensíveis) e redige segredos.
- `SemanticRecall` e `WorkingMemory` isolados estritamente pelo `resourceId` (`uzina:agency:org:<orgId>:project:<projectId>`).
- `PromptInjectionGuardProcessor` neutraliza *indirect prompt injection* em checkouts não confiáveis e outputs de ferramentas externas.

---

## 5. Plano de Testes (*Spec → Teste* antes do Build)
- **Unitários (`packages/core/tests/slice26-skills-loader-v2.test.ts`):** descoberta de `references/`/`templates/`/`scripts/`, budgets (`strictBudgets`), path traversal/symlink em `loadSkillResource`, `selectNonConflictingSkillsForStage` (`test.each`).
- **Integração (`packages/mastra-runtime/tests/slice26-controller-memory-skills.integration.test.ts`):** PGlite em memória + `MastraLanguageModelV2Mock` validando resolução dinâmica por modo/tenant no `AgentController`, playbooks + `load_uzina_skill`, `WorkingMemory` + `SemanticRecall` isolado entre organizações e neutralização de *prompt injection*.

---

## 6. Critérios de Pronto (DoD)
- [x] Contratos Zod compilando sem quebrar testes existentes.
- [x] `skills-loader.ts` v2 aprovado nos testes unitários e regressão de `skills-loader.test.ts`.
- [x] `AgentController` sem `"openai/gpt-4o-mini"` hardcoded; resolve modelo do tenant por modo.
- [x] Playbooks Sênior + `load_uzina_skill` + `WorkingMemory` + `SemanticRecall` + `PromptInjectionGuardProcessor` validados em integração.
- [x] `test-critic`, `appsec-auditor`, `pnpm verify` e `factory-verifier` verdes.

---

## 7. Revisão EGM Pré-Código (Plan Gate)
Alinhado ao Plano Mestre aprovado pelo usuário e ao padrão `execute-slice`.

---

## 8. Evidências Reais Pós-Código (Verify Gate)
* **Saída `node scripts/check-no-ee.mjs`:** `OK [check-no-ee]: Nenhuma dependência ou importação comercial Mastra ee/ encontrada.` (`exit 0`).
* **Saída `node scripts/audit-tests.mjs`:** `Arquivos: 84 | Testes: 275 | Suprimidos: 2 | Violações: 0` (`exit 0`).
* **Saída `pnpm verify`:** `34/34` tasks Turbo `successful` (`2m55.394s`, `exit 0`): `@uzina/contracts` `203/203`, `@uzina/core` `193/193` (incluindo `slice26-skills-loader-v2.test.ts` `18/18`), `@uzina/db` `39 passed | 1 skipped` (`postgres-live.test.ts`), `@uzina/codebase-intel` `13/13`, `@uzina/security-engine` `19/19`, `@uzina/cli` `13/13`, `@uzina/opencode-bridge` `58/58`, `@uzina/mastra-runtime` `93/93` (incluindo `slice26-controller-memory-skills.integration.test.ts` `20/20`), `@uzina/web` `36/36` + Next.js `16.4.6` Turbopack build limpo.
* **Resumo `test-critic` / `appsec-auditor` / `factory-verifier`:**
  * `test-critic`: 8 apontamentos incorporados (symlinks/junctions reais, `test.each` para paths inválidos e `PromptInjectionGuard`, caminhos Windows, `maxBytes`, `backingAgent` sem `modelOverride`, persistência real de `WorkingMemory`, isolamento bilateral OrgA/OrgB no `SemanticRecall` + fail-closed sem ator, `processToolResult` com redação e `agent.generate`).
  * `appsec-auditor`: achados `CRITICAL`/`HIGH`/`MEDIUM`/`LOW` corrigidos (ordem `PromptInjectionGuard` → `SecretRedaction` + `sanitizeUntrustedToolOutput` + redação em `args` in-place no `processToolResult`, `followSymlinks: true` + `lstatSync` em `skills-loader.ts`, bloqueio de `.git` e trailing dots NTFS, normalização NFKC + `\p{Cf}`, sanitização de tags no `SemanticRecall` e validação multi-tenant de `projectId`/`resourceId` + `knownSecrets` dinâmicos no `AgentController`).
  * `factory-verifier`: **PASS** (`git diff main` conferido contra todos os requisitos).
* **Branch:** `fix/slice-26-controller-model-resolver-skills-loader-v2`
