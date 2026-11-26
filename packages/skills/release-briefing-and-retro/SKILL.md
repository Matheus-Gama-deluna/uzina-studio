---
name: release-briefing-and-retro
description: Use quando precisar preparar o Risk-Ranked Briefing para decisão HITL e abertura de Draft PR na Fase 5, validar plano de rollout/rollback e destilar lições retrospectivas para a memória QMD na Fase 6.
applies_to_roles: [verifier, copilot]
phase: release
role_category: lead
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca abra Draft PR ou solicite aprovação HITL sem consolidar o Risk-Ranked Briefing com Confidence Score (0-100), plano de rollback e impacto FinOps, e sempre destile lições em QMD após rejeição humana ou >= 2 reprovações no Verify.
---

# Skill: Release Briefing & Retrospective Distillation (Fases 5 & 6)

## Iron Law

> **Nunca submeta um entregável para a Caixa de Decisões HITL ou abertura de Draft PR sem um `DecisionRiskBriefing` ordenado por risco com `Confidence Score (0–100)`, checklist de migração/env/rollback e custo FinOps real; e sempre destile uma lição permanente em QMD após qualquer rejeição HITL ou $\ge 2$ ciclos de reprovação no Verify.**

A atenção do revisor humano é o recurso mais escasso da fábrica: destaque primeiro o que pode quebrar produção ou segurança.

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - `EvidencePack` completo do `stageVerify` (`VerifierVerdictOutputV2`, `testCommandOutput`, SARIF triado, `VisualA11yVerifyReport` quando `has_ui: true`).
  - Dados de custo/retrabalho obtidos via `read_finops_and_risk_digest` e `inspect_worktrees_and_locks`.
- **Exit Artifact (Saída Imutável):**
  - `DecisionRiskBriefing` estruturado seguindo `templates/pr-risk-briefing.md` para Caixa de Decisões e descrição de Draft PR;
  - Registro QMD pós-entrega (`distill_retrospective_memory`) e sincronização de OpenSpec delta (pós-merge), com worktrees limpos.

## Protocolo

### Step 0 — Coleta de Evidências Reais e FinOps
1. Leia `read_deliverable_evidence_and_diff`, `read_finops_and_risk_digest` e `inspect_worktrees_and_locks`.
2. Verifique que nenhuma métrica ou status está sendo inferido sem saída real observada.

### Step 1 — Consolidação do Risk-Ranked Briefing (Fase 5)
1. Carregue `templates/pr-risk-briefing.md` e ordene os impactos do **maior risco para o menor**:
   - Alterações em Auth/RBAC/Multi-tenancy ou Cofre;
   - Migrações de banco de dados (Expand vs Contract);
   - Novas dependências, variáveis de ambiente ou permissões;
   - Mudanças visuais e cobertura de testes / lacunas `skipped_missing_binary`.
2. Calcule o **Confidence Score (0–100)** com justificativa objetiva e redija o plano concreto de **Rollout & Rollback**.

### Step 2 — Destilação Retrospectiva e Higiene Pós-Merge (Fase 6)
1. Se houve rejeição HITL com feedback ou `verifyAttempts >= 2`, execute `distill_retrospective_memory` (`category: "convention"` ou `"security_triage"`) registrando a causa-raiz e a regra preventiva para futuros ciclos.
2. Em projetos Brownfield com `openSpecDelta`, garanta a sincronização do delta na especificação viva após o merge e verifique que não restaram worktrees órfãos.

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "O diff tem 30 arquivos, vou resumir dizendo 'várias melhorias no módulo'." | Obriga o revisor humano a caçar onde estão os riscos de segurança e migração. | Ordene explicitamente os arquivos críticos no topo do `DecisionRiskBriefing`. |
| "Faltou rodar um scanner local, mas o resto passou; vou dar Confidence Score 100." | Mascara cobertura incompleta e engana o aprovador HITL. | Reduza o `Confidence Score` e liste a lacuna em *Riscos e Ressalvas*. |
| "O entregável foi aprovado depois de 3 falhas no Verify; podemos seguir direto." | Sem destilação em QMD, o mesmo erro voltará no próximo slice. | Chame `distill_retrospective_memory` registrando a lição aprendida antes de fechar. |

## Ponteiros Progressivos

- Carregue [templates/pr-risk-briefing.md](templates/pr-risk-briefing.md) para gerar o corpo oficial da decisão HITL e do Draft PR.
- Em evoluções Brownfield pós-merge, combine com `openspec-brownfield-delta` para arquivar o delta aprovado na documentação viva.
