---
name: brownfield-archaeology
description: Use quando precisar diagnosticar um repositório existente em modo somente-leitura, mapear dependências reais função-a-função, identificar seams para Strangler Fig e calcular o Scorecard de Maturidade (0-100).
applies_to_roles: [architect, discovery]
phase: discovery
role_category: lead
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca edite arquivos, rode comandos mutantes ou proponha refatorações em código existente antes de concluir o mapeamento somente-leitura e calcular o Scorecard de Maturidade (0-100).
---

# Skill: Brownfield Archaeology (Arqueologia Somente-Leitura)

## Iron Law

> **Nunca edite arquivos, execute comandos mutantes ou proponha refatorações em sistemas existentes antes de mapear os fluxos reais, identificar os pontos de costura (*seams*) e emitir o Scorecard de Maturidade (0–100).**

Mudanças às cegas em bases legadas destroem contratos implícitos. O diagnóstico deve expor o estado real do código — inclusive módulos sem testes, dívidas de segurança e acoplamentos ocultos.

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - Projeto existente com código-fonte acessível no workspace ou grafo AST indexado (`@uzina/codebase-intel`).
  - Permissão de execução estritamente em modo leitura (`plan` / `inspect`).
- **Exit Artifact (Saída Imutável):**
  - **Raio-X Brownfield** contendo:
    - Inventário de manifestos, rotas/APIs, tabelas/schemas e suíte de testes;
    - Mapa de fluxos críticos função-a-função (entrypoint → validação → domínio → persistência);
    - Lista de *seams* (pontos de interceptação) para aplicar `characterization_strangler`;
    - **Scorecard de Maturidade (0–100)** calculado com a rubrica de `references/maturity-scorecard-rubric.md`.

## Protocolo

### Step 0 — Contenção Somente-Leitura
1. Confirme que nenhuma ferramenta de escrita (`write_file`, `edit_file`, `delete`) ou comando destrutivo será invocada.
2. Consulte `search_qmd_memories` e `read_project_deliverables` para recuperar diagnósticos anteriores do mesmo repositório.

### Step 1 — Inventário Estrutural e de Fronteiras
1. Execute `inspect_codebase_skeleton` para mapear pacotes, diretórios principais, entrypoints HTTP/CLI e configurações de build/CI.
2. Inspecione manifestos (`package.json`, `tsconfig.json`, schemas Drizzle/Prisma/SQL) e identifique as versões reais de runtime e dependências críticas.
3. Verifique a existência de suítes unitárias, de integração e E2E, além de scripts de verificação (`verify`, `lint`, `typecheck`).

### Step 2 — Mapeamento Função-a-Função e Seams
1. Para cada módulo afetado pela demanda, use `trace_symbol_call_graph` e `read_symbol_source_slice` para rastrear chamadas da borda até o banco de dados.
2. Identifique efeitos colaterais globais, singletons, dependências circulares e pontos sem cobertura de teste.
3. Marque *seams* onde testes de caracterização devem ser inseridos antes de qualquer substituição incremental (*Strangler Fig*).

### Step 3 — Cálculo do Scorecard de Maturidade (0–100)
1. Carregue `references/maturity-scorecard-rubric.md` e pontue objetivamente as 5 dimensões (0 a 20 pontos cada).
2. Se a pontuação total for `< 60` ou um módulo crítico não tiver cobertura, recomende explicitamente a estratégia `characterization_strangler`.

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "O README diz como a arquitetura funciona, não preciso ler o código." | Documentação legada costuma divergir drasticamente da implementação atual. | Leia os entrypoints e schemas reais via `read_symbol_source_slice`. |
| "Já vi um bug óbvio aqui, vou corrigir durante o diagnóstico." | Mistura exploração com mutação sem testes de caracterização nem aprovação. | Registre o achado no Raio-X e aguarde a fase de contrato/build. |
| "Os nomes das pastas são claros; não precisa rastrear chamadas." | Imports cruzados e helpers globais escondem impacto colateral em rotas vizinhas. | Execute `trace_symbol_call_graph` e `analyze_change_impact` nos alvos. |
| "Dou nota alta no Scorecard porque o projeto compila." | Compilar sem testes automatizados, sem CI ou sem validação de entrada mascara risco severo. | Aplique estritamente os critérios de `references/maturity-scorecard-rubric.md`. |

## Ponteiros Progressivos

- Carregue [references/maturity-scorecard-rubric.md](references/maturity-scorecard-rubric.md) antes de atribuir qualquer nota ao Scorecard (0–100).
- Após concluir o Raio-X, faça o handoff para `openspec-brownfield-delta` (deltas de especificação) ou `architecture-blueprint` (ADR + Story Shards).
