# Dossiê do Slice 27 — Biblioteca de 16 Skills v2 (Iron Laws & Anti-Conflito)

* **Status:** `Concluído`
* **Branch:** `feat/slices-27-34-agentic-evolution-v2` (commit `4cf36b1`)
* **Estratégia Aplicada:** *Domain-First + Progressive Disclosure (`agentskills.io`) + TDD com `test.each`*
* **Spec de Referência:** [plano-mestre-evolucao-agentes-v2-slices-26-34.md](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/docs/planos/plano-mestre-evolucao-agentes-v2-slices-26-34.md) & [dossie-agentes-por-fase-v2.md](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/docs/planos/dossie-agentes-por-fase-v2.md)

---

## 1. Objetivo e Escopo Estrito
Resolve **GAP-02** elevando o catálogo de skills nativas em `packages/skills/` de 8 fichas curtas para **16 skills autorais sob licença `Apache-2.0`**, seguindo `agentskills.io` (frontmatter plano, orçamentos `name <= 64`, `description <= 1024`, `< 500` linhas, **Iron Law**, **Entry Gate & Exit Artifact**, **Protocolo**, **Red Flags (Anti-Racionalização)** e **Ponteiros Progressivos** para sub-recursos reais em `references/`, `templates/` e `scripts/`).

---

## 2. Entregas Realizadas (`4cf36b1`)
- **8 Skills Existentes Evoluídas (+ sub-recursos em disco):**
  1. `discovery-interview` (`templates/shape-spec-template.md`)
  2. `brownfield-archaeology` (`references/maturity-scorecard-rubric.md`)
  3. `architecture-blueprint` (`templates/adr-rfc-template.md`)
  4. `visual-design-md` (`references/tokens-wcag-checklist.md`)
  5. `contract-first-msw` (`templates/contract-drift-test.md`)
  6. `test-quality-engineering` (`references/bva-anti-patterns.md`)
  7. `safe-db-migrations` (`scripts/check-migration-ddl.mjs` — detector Node executável para DDL destrutivo)
  8. `secure-code-audit` (`references/sarif-triage-guide.md`)
- **8 Novas Skills Autorais Criadas (`Apache-2.0`):**
  9. `domain-event-storming-bdd` (`templates/bdd-rbac-matrix.md`)
  10. `openspec-brownfield-delta` (`templates/delta-spec-template.md`)
  11. `threat-modeling-stride-fmea` (`references/stride-fmea-matrix.md`)
  12. `ui-design-critique-a11y` (`references/nielsen-wcag-5states.md`)
  13. `systematic-debugging-3-strikes` (`references/scientific-debug-protocol.md`)
  14. `property-based-and-mutation-qa` (`templates/fast-check-zod.md`)
  15. `differential-appsec-sharp-edges` (`references/sharp-edges-checklist.md`)
  16. `release-briefing-and-retro` (`templates/pr-risk-briefing.md`)
- **Testes:**
  - [slice27-skills-catalog-integrity.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/core/tests/slice27-skills-catalog-integrity.test.ts) (`test.each` cobrindo todas as 16 skills, `strictBudgets`, `Apache-2.0`, seções obrigatórias, existência física de recursos e `selectNonConflictingSkillsForStage`).
  - [skills-loader.test.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/core/tests/skills-loader.test.ts) atualizado para o catálogo de 16 skills.

---

## 3. Evidências de Verificação
- `pnpm --filter @uzina/core build`: **PASS**
- `pnpm --filter @uzina/core test -- tests/skills-loader.test.ts tests/slice27-skills-catalog-integrity.test.ts`: **2 files, 34 tests passed**
- `node scripts/check-no-ee.mjs`: **exit 0**
- `node scripts/audit-tests.mjs`: **0 violações**
- *Pendente apenas:* inclusão na validação consolidada `pnpm verify` global na Onda 4.
