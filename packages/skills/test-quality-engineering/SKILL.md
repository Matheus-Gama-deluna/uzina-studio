---
name: test-quality-engineering
description: Use quando precisar projetar ou auditar suítes de testes em TDD Red-Green-Refactor, aplicando Análise de Valor Limite (BVA), Partição de Equivalência, dependências reais (PGlite/MSW) e eliminação de test theater.
applies_to_roles: [builder, verifier]
phase: verify
role_category: reference
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca escreva código de produção sem antes observar um teste derivado da Spec falhar pelo motivo certo (RED), jamais mocke banco de dados em testes de integração e nunca aceite testes sem asserção comportamental real.
---

# Skill: Test Quality Engineering (TDD Estrito & Anti-Teatro de Cobertura)

## Iron Law

> **Nenhum código de produção sem um teste derivado da Spec e dos contratos Zod falhando primeiro pelo motivo certo (RED); nunca mocke o banco de dados em testes de integração (use PGlite em memória) e jamais aceite testes sem asserção real ou que espelhem a lógica interna.**

Testes existem para detectar regressões e violação de invariantes de negócio — nunca para inflar porcentagem de cobertura.

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - `ShapeSpec` (cenários BDD), `ArchitectBlueprintV2` (`storyShards`) e contratos `@uzina/contracts`.
  - Acesso a `read_symbol_source_slice` e `run_test_anti_pattern_audit`.
- **Exit Artifact (Saída Imutável):**
  - Arquivos de teste dedicados por slice (`contractTestFiles`) cobrindo sucesso, **Análise de Valor Limite (BVA)**, **Partição de Equivalência**, RBAC e isolamento multi-tenant;
  - Relatório `auditTestDirectory` com **0 violações**.

## Protocolo

### Step 0 — Leitura Silenciosa da Spec e Contratos
1. Leia os cenários `Dado/Quando/Então` do `ShapeSpec` e os limites definidos nos schemas Zod (`min`, `max`, enums, regex).
2. Mapeie os pontos de entrada e as dependências reais disponíveis (PGlite em memória para `@uzina/db`, MSW na borda de rede para HTTP externo).

### Step 1 — Derivação Spec → Teste (BVA + Partição de Equivalência + Segurança)
1. Para cada entrada ou regra numérica/textual, aplique **Análise de Valor Limite (BVA)**: teste exatamente `min - 1`, `min`, `max`, `max + 1`, string vazia `""`, espaços em branco e `0` / negativos.
2. Para cada endpoint ou ação autenticada, inclua obrigatoriamente casos de:
   - Usuário não autenticado (`401`);
   - Papel sem permissão (`auditor` tentando mutação → `403`);
   - Isolamento multi-tenant (`organizationId` A tentando acessar recurso da `organizationId` B).
3. Consolide **3 ou mais casos com o mesmo corpo** em `test.each` (*Tests as Data*).

### Step 2 — Ciclo Red-Green-Refactor e Poda Anti-Teatro
1. Execute o teste focado antes da implementação para confirmar falha pelo motivo esperado (não por erro de sintaxe ou import quebrado).
2. Carregue `references/bva-anti-patterns.md` e elimine qualquer anti-padrão antes de passar para `stageBuild` ou aprovar `stageVerify`:
   - Zero `toBeTruthy()` / `toBeDefined()` isolados;
   - Zero `try/catch` engolindo falha;
   - Zero `setTimeout`/`sleep` arbitrário em teste unitário;
   - Zero uso de `any` ou `as unknown as`.

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "Vou mockar o Drizzle `db.select` para o teste rodar mais rápido." | O mock aceita queries SQL quebradas, colunas inexistentes e ignora constraints/FKs. | Use PGlite em memória com as migrações reais aplicadas. |
| "O teste de build passou depois que alterei uma linha no arquivo de teste." | Alterar o teste de contrato durante o build para ficar verde é *reward hacking*. | Mantenha `contractTestFiles` imutáveis no build; corrija o código de produção. |
| "Vou checar `expect(result).toBeDefined()` porque o retorno muda muito." | Passa mesmo se a função retornar `{ error: true }` ou objeto vazio quebrado. | Valide campos específicos e o contrato Zod (`Schema.parse(result)`). |
| "Escrevi 6 testes copiados e colados mudando só o input." | Infla o arquivo, dificulta manutenção e viola a regra *Tests as Data*. | Agrupe os 6 casos em uma única tabela `test.each`. |

## Ponteiros Progressivos

- Carregue [references/bva-anti-patterns.md](references/bva-anti-patterns.md) para conferir exemplos concretos de BVA, partição de equivalência e anti-padrões bloqueados pelo auditor estático.
- Para parsers, cálculos financeiros, validadores ou regras puras combinatórias, combine com `property-based-and-mutation-qa`.
