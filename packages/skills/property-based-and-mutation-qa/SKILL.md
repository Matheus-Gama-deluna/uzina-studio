---
name: property-based-and-mutation-qa
description: Use quando precisar testar parsers, regras matemáticas, algoritmos puros ou schemas Zod complexos com Property-Based Testing (fast-check) e avaliar força de suíte via análise de mutantes.
applies_to_roles: [builder, verifier]
phase: verify
role_category: reference
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca valide parsers, serializadores, cálculos financeiros ou filtros de segurança apenas com 2 exemplos fixos; teste invariantes algébricas com entradas geradas e verifique se mutantes triviais quebram a suíte.
---

# Skill: Property-Based Testing & Mutation QA

## Iron Law

> **Nunca valide parsers, funções de sanitização/redação, cálculos numéricos ou validadores de fronteira usando apenas exemplos estáticos óbvios; defina invariantes universais (*round-trip*, idempotência, monotonicidade, negação de escape) e audite se mutações simples no código são mortas pelos testes.**

Se inverter um `>=` para `>`, remover um filtro de `organizationId` ou pular uma branch de validação não faz nenhum teste falhar, a suíte possui um **mutante sobrevivente crítico**.

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - Módulo puro, parser, validador Zod, algoritmo de ordenação/contraste ou função de segurança (`path-guard`, `redact`, cálculos FinOps).
  - Contrato Zod e cenários de borda já definidos.
- **Exit Artifact (Saída Imutável):**
  - Testes baseados em propriedades (`fast-check` ou gerador determinístico com seed fixa) seguindo `templates/fast-check-zod.md`;
  - Checklist de mutantes críticos verificados (ou relatório Stryker quando habilitado) provando que desvios lógicos falham na suíte.

## Protocolo

### Step 0 — Identificação de Funções Puras e Invariantes
1. Identifique no `git diff` ou `storyShards` funções com alto espaço de entrada: parsers, cálculos de custo/contraste, normalizadores de path, filtros de segurança e schemas Zod com `.superRefine`.
2. Escolha as propriedades matemáticas aplicáveis:
   - **Idempotência:** `f(f(x)) === f(x)` (ex.: normalização/redação);
   - **Round-trip:** `parse(format(x))` preserva dados esperados;
   - **Invariante de Segurança:** para qualquer string contendo `..` ou `\0`, `guard(s)` sempre lança erro;
   - **Simetria / Monotonicidade:** contraste WCAG(A, B) === WCAG(B, A).

### Step 1 — Testes Baseados em Propriedades (Seed Determinística)
1. Carregue `templates/fast-check-zod.md` e escreva propriedades determinísticas (sem flakiness) limitando `numRuns` (ex.: `50–100`) para manter execução rápida em CI.
2. Sempre registre ou fixe a `seed` quando reproduzir uma falha encontrada pelo gerador, convertendo o contraexemplo mínimo (*shrunk counterexample*) em caso explícito de regressão.

### Step 2 — Auditoria Adversarial por Mutantes (Fase 4)
1. Ao revisar o diff na Fase 4, simule mentalmente (ou via Stryker quando disponível) **5 mutações críticas** sobre as linhas alteradas:
   - Inverter operador relacional (`<` ↔ `<=`, `===` ↔ `!==`);
   - Remover cláusula `organizationId` ou checagem `OrgRole`;
   - Trocar retorno de erro por fallback silencioso (`return true` / `return []`);
   - Remover negação `!` ou curto-circuito `&&` / `||`;
   - Alterar constante de limite (`64`, `500`, `4.5`).
2. Se algum mutante sobreviver sem teste que o mate, reprove ou adicione o teste faltante.

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "Testei com `"a/b.ts"` e `"../etc/passwd"`, o parser funciona." | Variantes como `"a\\..\\..\\x"`, trailing dots NTFS ou unicode passam sem cobertura. | Escreva propriedade `fast-check` gerando segmentos e separadores arbitrários. |
| "Teste aleatório deixa o CI instável (flaky)." | Só fica flaky se não houver `seed` fixa ou se depender de relógio/rede. | Use funções puras e informe `seed` determinística no `fc.assert` quando necessário. |
| "A cobertura de linha deu 95%, nenhum bug escapa." | Executar uma linha sem verificar o resultado deixa mutantes vivos (0% de detecção real). | Audite mutantes críticos nas branches de segurança e regras de negócio. |

## Ponteiros Progressivos

- Carregue [templates/fast-check-zod.md](templates/fast-check-zod.md) para consultar padrões prontos de propriedades `fast-check` integradas a Vitest e schemas Zod.
- Na Fase 4, use em conjunto com `test-quality-engineering` e `differential-appsec-sharp-edges`.
