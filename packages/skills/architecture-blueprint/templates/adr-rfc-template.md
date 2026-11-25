# Template: ADR + Story Shards (Fase 2 — Arquitetura)

## 1. Decisão de Roteamento
- **Estratégia de Desenvolvimento:** `api_contract_first` | `domain_first` | `data_schema_first` | `frontend_first_msw` | `characterization_strangler` | `spike_first`
- **Padrão Tático:** `single_agent` | `split_lanes`
- **Execução Sequencial Obrigatória (`sequential`):** `true` | `false` *(obrigatório `true` se houver colisão de símbolos/arquivos compartilhados)*

## 2. Architecture Decision Record (ADR)
### Contexto
`<Qual problema estrutural ou restrição do ShapeSpec exige esta decisão?>`

### Opções Consideradas
1. **Opção A (Escolhida):** `<descrição, prós, contras e custo de manutenção>`
2. **Opção B (Descartada):** `<descrição e motivo objetivo da rejeição>`

### Decisão & Consequências
- **Decisão:** `<resumo direto do desenho escolhido>`
- **Impactos positivos e débitos aceitos:** `<trade-offs explícitos>`
- **Reversibilidade / Rollback:** `<como reverter sem perda de dados ou indisponibilidade>`

### Fitness Functions (Invariantes Verificáveis em CI)
- [ ] `<Ex.: check_dependency_boundaries retorna 0 violações>`
- [ ] `<Ex.: pnpm --filter <pacote> test passa com PGlite em memória>`

## 3. Story Shards (Fatiamento Executável)
| Shard | Objetivo | `allowedPaths` | `targetSymbols` | Cenários BDD | Comando de Verificação |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `shard-01` | `<Escopo atômico>` | `<caminho/exato/**>` | `<SímboloA, SímboloB>` | `BDD-1, BDD-2` | `<comando focado>` |
