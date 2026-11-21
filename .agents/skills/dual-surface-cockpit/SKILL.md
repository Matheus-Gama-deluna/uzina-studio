---
name: dual-surface-cockpit
description: >-
  Projeta e implementa as duas superficies web da Fabrica de Software no Next.js App Router:
  Superficie Executiva (Specs, Aprovacoes, Custos/Orcamento de Tokens, Roadmap) e Superficie
  Tecnica (Worktrees ao vivo, Diff Viewer, Telemetria de Subagentes Mastra e Console SAST).
  Use esta skill ao desenvolver telas, layouts ou componentes do cockpit da fabrica.
---

# Dual-Surface Cockpit — Superficies Executiva e Tecnica da Fabrica

Esta skill define a arquitetura visual e funcional das duas superficies da Fabrica de Software no Next.js App Router.

---

## 1. Superficie Executiva (`/cockpit/executive` ou `/projects/[id]/overview`)

Projetada para tomada de decisao rapida, governanca e controle de custos:
1. **Portao de Especificacao e Design (`Spec Approval Gate`)**:
   - Exibe a especificacao gerada, arquitetura proposta, riscos e botoes de **Aprovar Plano**, **Solicitar Ajuste** ou **Abortar**.
2. **FinOps e Economia de Modelos (`Token & Model Tiering Telemetry`)**:
   - Mostra em tempo real a distribuicao de consumo e economia por camada de modelo (`flash_lite` vs. `flash` vs. `pro`), custo estimado em USD por feature e orcamento restante.
3. **Progresso de Marcos e Qualidade**:
   - Indicadores claros de status do pipeline (`Spec -> Worktree -> TDD -> AppSec Gate -> Verifier -> PR Preview`).

---

## 2. Superficie Tecnica (`/cockpit/technical` ou `/projects/[id]/runs/[runId]`)

Projetada para engenheiros auditarem a execucao autonoma em profundidade:
1. **Inspetor de Git Worktrees e Diff Viewer**:
   - Lista worktrees ativos, branch associada, arquivos modificados e diff lado a lado ou unificado.
2. **Timeline de Subagentes Mastra & OpenCode SDK**:
   - Exibe cada passo dos agentes (`fast-scout`, `doc-researcher`, `builder`, `test-critic`, `appsec-auditor`, `factory-verifier`), modelo utilizado, latencia, tokens e logs de ferramentas.
3. **Console de Testes e AppSec (SARIF)**:
   - Mostra a saida real da suite de testes (RED -> GREEN), `tsc --noEmit` e o painel de vulnerabilidades SAST com filtro por severidade.
