# Template: Risk-Ranked Decision & PR Briefing

## 1. Resumo Executivo & Confidence Score
- **Entregável / Branch:** `<deliverableId>` · `<branchName>`
- **Confidence Score (0–100):** `<score>/100` *(baseado em Spec Matrix, testes frescos, SARIF e A11y)*
- **Custo & Retrabalho (FinOps):** `$<costUsd>` · `<totalTokens>` tokens · `<verifyAttempts>` tentativa(s) de Verify

## 2. Superfícies de Risco Ordenadas (Maior → Menor)
| Prioridade | Superfície | Mudança Real Observada | Mitigação / Evidência |
| :---: | :--- | :--- | :--- |
| **P0** | Auth / RBAC / Tenant / Crypto | `<Arquivos ou "Sem alteração">` | `<Teste PoV / Guard verificado>` |
| **P1** | Banco de Dados / Migrações | `<Expand/Contract ou "Sem alteração">` | `<check-migration-ddl + PGlite>` |
| **P2** | Dependências / Env Vars / CI | `<Novos pacotes/vars ou "Nenhum">` | `<check-no-ee + lockfile>` |
| **P3** | UI / Contratos / Domínio | `<Resumo funcional do diff>` | `<Playwright/axe-core + Contract Drift>` |

## 3. Evidências Reais Executadas (Pós-Última Edição)
- **Stage 1 (Spec Compliance):** `<X/X critérios BDD cobertos>`
- **Testes & Build:** `<saída objetiva dos comandos>`
- **AppSec / Scanners:** `<status dos scanners; destacar qualquer skipped_missing_binary>`

## 4. Plano de Rollout & Rollback
- **Pré-requisitos de deploy / env vars:** `<lista ou "Nenhum">`
- **Rollback seguro em < 5 min:** `<passos objetivos de reversão sem perda de dados>`

## 5. Retrospectiva (Obrigatório se Rejeição HITL ou `verifyAttempts >= 2`)
- **Causa-raiz do retrabalho:** `<descrição sem culpar pessoas>`
- **Lição destilada em QMD (`distill_retrospective_memory`):** `<regra preventiva gravada>`
