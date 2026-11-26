---
name: openspec-brownfield-delta
description: Use quando precisar especificar mudanças em sistemas existentes por meio de deltas ADDED, MODIFIED e REMOVED sobre especificações vivas sem reescrever o sistema inteiro, e sincronizá-las pós-merge.
applies_to_roles: [discovery, architect, copilot]
phase: architecture
role_category: lead
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca reescreva especificações inteiras para alterar uma funcionalidade existente nem proponha remoções sem declarar explicitamente os itens ADDED, MODIFIED e REMOVED com impacto de compatibilidade.
---

# Skill: OpenSpec Brownfield Delta (Especificação por Deltas)

## Iron Law

> **Nunca reescreva um documento inteiro para evoluir um módulo existente e nunca remova comportamentos sem declarar explicitamente o delta em três seções: `ADDED`, `MODIFIED` e `REMOVED`, acompanhado de análise de retrocompatibilidade.**

Especificar por deltas preserva o contrato vivo do sistema, reduz custo de revisão humana e torna o impacto verificável antes e depois do merge.

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - Projeto Brownfield ou entrega evolutiva com especificações/código pré-existentes.
  - Raio-X de `brownfield-archaeology` ou consulta às memórias/entregáveis do projeto.
- **Exit Artifact (Saída Imutável):**
  - **Delta Spec** estruturada seguindo `templates/delta-spec-template.md` (`ADDED / MODIFIED / REMOVED` + plano de compatibilidade e pós-merge sync).

## Protocolo

### Step 0 — Leitura Silenciosa da Especificação e Código Vivos
1. Consulte `read_project_deliverables`, `search_qmd_memories` e os documentos em `docs/` para localizar o comportamento vigente.
2. Em módulos de código, valide via `inspect_codebase_skeleton` e `analyze_change_impact` se o comportamento atual realmente bate com o texto documentado.

### Step 1 — Redação do Delta (`ADDED` / `MODIFIED` / `REMOVED`)
1. Carregue `templates/delta-spec-template.md`.
2. Classifique cada requisito alterado em exatamente uma lista:
   - **`ADDED`:** capacidades, rotas, campos ou invariantes inteiramente novos;
   - **`MODIFIED`:** regras existentes alteradas, registrando explicitamente o estado **Antes → Depois**;
   - **`REMOVED`:** capacidades depreciadas ou removidas, com plano de transição/migração.

### Step 2 — Verificação de Compatibilidade & Sync Pós-Merge
1. Para cada item em `MODIFIED` ou `REMOVED`, declare se há risco de quebra para clientes, dados salvos ou testes existentes.
2. Na Fase 6 (pós-merge), arquive/sincronize o delta aprovado no documento vivo do projeto para evitar drift documental.

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "É mais fácil reescrever a spec toda do zero." | Oculta o que mudou de verdade e faz o revisor perder regressões sutis. | Escreva apenas o delta `ADDED / MODIFIED / REMOVED` com `Antes → Depois`. |
| "Não listei o que foi removido porque ninguém usa mais." | Consumidores ocultos ou testes antigos quebram sem rastreabilidade. | Registre em `REMOVED` com verificação via `analyze_change_impact`. |
| "Depois do merge a documentação se atualiza sozinha." | Documentos desatualizados geram alucinação nos próximos ciclos agênticos. | Inclua o passo de sincronização pós-merge na lista de saída. |

## Ponteiros Progressivos

- Carregue [templates/delta-spec-template.md](templates/delta-spec-template.md) para emitir o artefato de delta compatível com `ArchitectBlueprintV2Schema.openSpecDelta`.
- Combine com `brownfield-archaeology` quando o repositório ainda não possuir Raio-X ou Scorecard de Maturidade.
