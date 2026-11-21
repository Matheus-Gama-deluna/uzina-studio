---
name: appsec-engine-sarif-pipeline
description: >-
  Implementa o motor AppSec interno da Fabrica de Software (execucao automatizada de Semgrep,
  Gitleaks e Trivy sobre worktrees, criacao de regras customizadas e parsing unificado de SARIF).
  Use esta skill ao construir o pipeline de seguranca da fabrica ou o visualizador de vulnerabilidades.
---

# AppSec Engine & SARIF Pipeline (Inspirada em Trail of Bits)

Esta skill orienta a construcao do **AppSec Engine** da fabrica — o subsistema que audita automaticamente o codigo gerado pelos agentes em cada Git worktree antes de permitir a abertura ou merge de Pull Requests.

---

## 1. Pipeline de Tripla Varredura no Worktree

Para cada run de codificacao no worktree (`.worktrees/task-<id>`):
1. **Gitleaks (Deteccao de Segredos)**:
   - Verifica se nenhum token, chave privada ou credencial foi introduzido nos arquivos ou commits da branch.
2. **Semgrep (SAST Contextual)**:
   - Executa regras TypeScript/React/Next.js/Node + regras customizadas da fabrica (ex.: bloquear `eval`, `dangerouslySetInnerHTML` sem sanitizacao, queries SQL concatenadas ou imports `@mastra/*/ee`).
3. **Trivy / Dependency Audit (SCA)**:
   - Audita `package-lock.json` / `pnpm-lock.yaml` em busca de CVEs criticas ou altas introduzidas por novas dependencias.

---

## 2. Normalizacao SARIF e Portao de Bloqueio

1. **Parser Unificado Tipado com Zod**:
   - Normalize as saidas JSON/SARIF2.1.0 das ferramentas em um schema canonico `SecurityFindingSchema` (`tool`, `ruleId`, `severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'`, `filePath`, `startLine`, `endLine`, `message`, `remediationHint`).
2. **Politica de Auto-Correcao vs. Bloqueio**:
   - Se houver achados `CRITICAL` ou `HIGH`, o portao AppSec **bloqueia o PR** e devolve a lista estruturada de `SecurityFinding` para o agente construtor no OpenCode SDK/Mastra corrigir automaticamente e re-executar o pipeline.
