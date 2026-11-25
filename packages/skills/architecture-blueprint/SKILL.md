---
name: architecture-blueprint
description: Use quando precisar definir a arquitetura técnica de uma entrega na Fase 2, escolhendo estratégia de desenvolvimento, ADR com reversibilidade, Story Shards com File Ownership e análise de contenção de símbolos.
applies_to_roles: [architect]
phase: architecture
role_category: lead
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca aprove um blueprint técnico sem consultar o grafo de símbolos e impacto real do código, sem registrar um ADR com opções e reversibilidade, e sem declarar allowedPaths e targetSymbols por Story Shard.
---

# Skill: Architecture Blueprint & Strategy Router

## Iron Law

> **Nunca aprove um blueprint técnico sem consultar o grafo real de símbolos e o impacto de mudança (`analyze_change_impact`), sem registrar um ADR com alternativas e plano de reversibilidade, e sem declarar explicitamente `allowedPaths` e `targetSymbols` para cada Story Shard.**

É proibido propor novos pacotes ou helpers duplicando utilitários existentes no monorepo, bem como violar a hierarquia de importações (`@uzina/contracts` → `@uzina/db`/`@uzina/core` → engines → `@uzina/mastra-runtime` → `apps/web`).

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - `ShapeSpec` aprovado na Fase 1 (ou Raio-X Brownfield quando aplicável).
  - Acesso às ferramentas de código e memória (`trace_symbol_call_graph`, `analyze_change_impact`, `check_dependency_boundaries`, `search_qmd_memories`).
- **Exit Artifact (Saída Imutável):**
  - `ArchitectBlueprintV2` contendo:
    - Estratégia de desenvolvimento e padrão tático (`single_agent` vs `split_lanes`);
    - ADR estruturado seguindo `templates/adr-rfc-template.md`;
    - Matriz de riscos **STRIDE/FMEA** para superfícies sensíveis;
    - Lista de **Story Shards** atômicos com `allowedPaths`, `targetSymbols`, `acceptanceScenarioIds` e `verificationCommands`;
    - Memória arquitetural persistida via `create_qmd_memory` (`category: "architecture"`).

## Protocolo

### Step 0 — Leitura Silenciosa do Codebase e Fronteiras
1. Consulte `search_qmd_memories` e `read_project_deliverables` para alinhar convenções e entregas em andamento.
2. Execute `inspect_codebase_skeleton`, `trace_symbol_call_graph` e `analyze_change_impact` nos módulos relacionados ao `ShapeSpec`.
3. Leia assinaturas existentes com `read_symbol_source_slice` antes de projetar qualquer interface nova.

### Step 1 — Roteamento Duplo de Estratégia e Padrão Tático
1. Selecione exatamente uma entre as 6 estratégias oficiais:
   - `frontend_first_msw`, `api_contract_first`, `domain_first`, `data_schema_first`, `characterization_strangler` ou `spike_first`.
2. Escolha o padrão tático:
   - `single_agent`: obrigatório quando shards tocarem arquivos compartilhados (`schema.ts`, `package.json`, `contracts/index.ts`);
   - `split_lanes`: permitido apenas quando os `allowedPaths` e `targetSymbols` forem estritamente disjuntos (sem colisão no `SymbolLockManager`).

### Step 2 — ADR, Fitness Functions e Story Sharding
1. Carregue `templates/adr-rfc-template.md` e documente contexto, no mínimo 2 opções consideradas, decisão, consequências, *Fitness Functions* verificáveis e estratégia de reversibilidade/rollback.
2. Quebre a entrega em **Story Shards** autocontidos (Walking Skeleton + Vertical Slices), ligando cada shard aos cenários BDD do `ShapeSpec`.
3. Valide todas as dependências propostas com `check_dependency_boundaries` antes de finalizar.

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "Vou criar um helper novo aqui porque é mais rápido do que procurar." | Gera duplicação silenciosa e diverge do padrão do monorepo. | Rode `query_codebase_symbols` / `trace_symbol_call_graph` e reutilize a base existente. |
| "Estes dois shards podem rodar em paralelo para ganhar tempo." | Se ambos editarem `contracts` ou o mesmo símbolo, haverá conflito de merge ou lock. | Declare `targetSymbols` e marque execução sequencial se houver qualquer interseção. |
| "Não precisa de ADR, a escolha da biblioteca é padrão." | Decisões sem registro de trade-off viram dívida opaca impossível de auditar depois. | Preencha o ADR com ao menos 2 opções e critério de reversibilidade. |
| "A segurança dessa rota a gente vê na revisão final." | Falhas estruturais de trust boundary custam 10x mais para corrigir após o build. | Acione `threat-modeling-stride-fmea` durante o desenho do blueprint. |

## Ponteiros Progressivos

- Carregue [templates/adr-rfc-template.md](templates/adr-rfc-template.md) para redigir o ADR e a tabela de Story Shards.
- Em fluxos com autenticação, cofre de segredos, uploads ou agentes/MCP, carregue também `threat-modeling-stride-fmea` (categoria `reference`).
- Em projetos Brownfield com documentação viva, combine com `openspec-brownfield-delta` para especificar deltas `ADDED / MODIFIED / REMOVED`.
