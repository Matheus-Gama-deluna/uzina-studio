---
name: contract-first-msw
description: Use quando precisar definir contratos Zod/OpenAPI primeiro, derivar Story Shards executáveis e configurar mocks de rede com MSW sem Contract Drift ou dados hardcoded em componentes React.
applies_to_roles: [builder, architect]
phase: build
role_category: reference
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca escreva componentes de UI ou handlers HTTP antes de travar os contratos Zod em @uzina/contracts e jamais insira dados mockados hardcoded ou flags isMock dentro de componentes React.
---

# Skill: Contract-First + MSW (Story Sharding & Zero Contract Drift)

## Iron Law

> **Nunca escreva handlers HTTP, Server Actions ou componentes React antes de travar os schemas Zod em `@uzina/contracts`, e jamais insira dados mockados hardcoded ou condicionais `if (isMock)` dentro de componentes de UI.**

Todo mock de frontend deve residir exclusivamente na borda de rede via **Mock Service Worker (MSW)** e ser validado continuamente pelo mesmo schema Zod consumido pela API real.

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - `ArchitectBlueprintV2` com `storyShards` e `PrototypeComponentManifest` (quando `has_ui: true`).
  - Assinaturas reais verificadas via `read_symbol_source_slice` e `trace_symbol_call_graph`.
- **Exit Artifact (Saída Imutável):**
  - Schemas e DTOs versionados em `@uzina/contracts` (sem imports de pacotes internos);
  - Handlers MSW cobrindo todos os estados reais (`200`, `400/422`, `401/403`, `500` e listas vazias);
  - Teste automatizado de **Contract Drift Check** seguindo `templates/contract-drift-test.md`.

## Protocolo

### Step 0 — Leitura Silenciosa dos Contratos Existentes
1. Inspecione `packages/contracts/src/` via `read_symbol_source_slice` e `check_dependency_boundaries` para reutilizar enums e schemas existentes (`RiskLevelSchema`, `OrgRoleSchema`, paginação).
2. Leia o `PrototypeComponentManifest` para garantir que os DTOs de resposta alimentem todos os 5 estados da UI.

### Step 1 — Trava de Contratos e Story Sharding
1. Defina schemas de entrada (`*InputSchema`) e saída (`*OutputSchema`) em `@uzina/contracts` com limites explícitos (`max`, `min`, `trim`, `uuid`) e zero `any`.
2. Para cada shard do blueprint, garanta que cada campo do payload tenha dono claro entre API, banco e UI.
3. Nunca exponha chaves cifradas, tokens ou segredos internos em contratos serializados para o cliente ou fixtures MSW.

### Step 2 — Handlers MSW na Borda & Contract Drift Check
1. Crie/atualize handlers MSW cobrindo obrigatoriamente: sucesso (`200`/`201`), payload inválido (`400`/`422`), não autenticado/sem permissão (`401`/`403`), lista vazia (`200` com `[]`) e falha transiente (`500`).
2. Carregue `templates/contract-drift-test.md` e crie o teste que valida **tanto** o payload dos handlers MSW **quanto** a resposta do handler real contra o mesmo schema Zod.

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "Vou colocar um array estático no componente só enquanto a API não fica pronta." | Gera código morto e diverge silenciosamente do formato real da API. | Mova o fixture imediatamente para um handler MSW validado por schema Zod. |
| "O handler MSW só precisa retornar o caminho feliz 200." | Esconde quebras de UI nos estados `empty`, `error` (422/500) e `403`. | Adicione variantes MSW para `400/422`, `401/403`, `500` e lista vazia. |
| "Vou tipar o payload com `interface` local no frontend para andar mais rápido." | Cria *Contract Drift* assim que o backend renomeia ou valida um campo. | Importe o tipo inferido (`z.infer<typeof Schema>`) diretamente de `@uzina/contracts`. |
| "Depois eu adiciono a validação Zod na rota HTTP." | Rotas sem schema na borda aceitam payload arbitrário e quebram invariantes. | Valide `safeParse` na primeira linha do handler antes de qualquer lógica. |

## Ponteiros Progressivos

- Carregue [templates/contract-drift-test.md](templates/contract-drift-test.md) para gerar o teste de aderência entre handlers MSW, API real e `@uzina/contracts`.
- Combine com `test-quality-engineering` na Fase 3A para derivar testes RED completos antes de iniciar o `stageBuild`.
