---
name: architecture-blueprint
description: Seleciona a estratégia de desenvolvimento (6 opções), define Walking Skeleton + Vertical Slices e declara posse de arquivos.
applies_to_roles: [architect]
---

# Skill: Architecture Blueprint & Strategy Router

## Regras Obrigatórias
1. **Roteamento Duplo:** Selecione explicitamente:
   - **Estratégia de Desenvolvimento:** `frontend_first_msw`, `api_contract_first`, `domain_first`, `data_schema_first`, `characterization_strangler` ou `spike_first`;
   - **Padrão Tático:** `single_agent` (padrão para tarefas simples/acopladas) ou `split_lanes` (apenas para módulos sem sobreposição de arquivos).
2. **Walking Skeleton + Vertical Slices:** Quebre a entrega em fatias verticais autocontidas com contratos explícitos antes da implementação.
3. **File Ownership (`allowed_paths`):** Liste explicitamente quais arquivos/pastas cada fatia pode modificar. Se duas fatias tocam arquivos compartilhados (`schema.ts`, `package.json`, contratos globais), marque execução sequencial.
