# Template: OpenSpec Delta (`ADDED` / `MODIFIED` / `REMOVED`)

## 1. Referência da Especificação Viva
- **Módulo / Domínio Alvo:** `<nome do subsistema ou documento base>`
- **Origem:** `brownfield` | `evolution`

## 2. `ADDED` (Novos Comportamentos e Contratos)
- **ADD-01:** `<Descrição clara do novo requisito, critério BDD e escopo RBAC>`

## 3. `MODIFIED` (Alterações sobre Comportamento Existente)
- **MOD-01:** `<Regra ou contrato alterado>`
  - **Antes:** `<Comportamento atual observado no código/spec>`
  - **Depois:** `<Novo comportamento esperado>`
  - **Retrocompatibilidade:** `<Sim / Não — estratégia de transição>`

## 4. `REMOVED` (Remoções e Depreciações)
- **REM-01:** `<Comportamento/campo removido>`
  - **Motivo e impacto:** `<Consumidores afetados e plano de migração>`

## 5. Checklist de Sync Pós-Merge (Fase 6)
- [ ] Delta incorporado ao documento vivo / memória QMD após aprovação e merge.
- [ ] Contratos e fixtures obsoletos removidos sem deixar órfãos.
