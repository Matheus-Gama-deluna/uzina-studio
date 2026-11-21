# Dossiê do Slice X — [Título do Slice]

* **Status:** `Rascunho` | `Plan Gate EGM Aprovado` | `Em Codificação` | `Concluído`
* **Branch:** `feat/slice-0X-<slug>`
* **Estratégia Aplicada:** *(ex.: Contract-First + Walking Skeleton)*
* **Spec de Referência:** `docs/especificacao-tecnica-fase-1-v1.1.md` (Seções ...)

---

## 1. Objetivo e Escopo Estrito
O que este Slice entrega de ponta a ponta e o que fica **explicitamente fora de escopo** (pertencente a Slices futuros).

## 2. Fronteiras de Pacotes e Arquivos Previstos
Lista explícita de diretórios/arquivos a criar ou modificar, respeitando as fronteiras de importação (`@uzina/contracts` → `@uzina/db` & `@uzina/core` → ...).

## 3. Contratos Compartilhados (`@uzina/contracts`)
Schemas Zod, enums, DTOs e endpoints/eventos introduzidos ou alterados neste Slice.

## 4. Persistência, Segurança e Decisões Técnicas
Tabelas/colunas, variáveis de ambiente, regras de validação Zod, restrições de segurança/processo único.

## 5. Plano de Testes (*Spec → Teste* antes do Build)
* **Unitários (*Tests as Data*):** ...
* **Integração (PGlite / MSW / Contract Drift):** ...
* **Casos de Fronteira e Segurança:** ...

## 6. Critérios de Pronto (DoD)
Checklist objetivo que precisa passar para declarar o Slice concluído.

## 7. Revisão EGM Pré-Código (Plan Gate)
Resumo dos apontamentos de `egm-implementation-readiness` (e `egm-design` / `egm-zoom-out` quando aplicável) e como foram resolvidos neste Dossiê.

## 8. Evidências Reais Pós-Código (Verify Gate)
*(Preencher somente após executar os comandos ao final do Slice)*
* **Saída `node scripts/check-no-ee.mjs`:**
* **Saída `pnpm verify`:**
* **Resumo `test-critic` / `appsec-auditor` / `factory-verifier`:**
* **Commit / PR:**
