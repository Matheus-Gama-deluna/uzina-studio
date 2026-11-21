---
name: secure-code-audit
description: Guia a triagem contextual de achados SARIF em 3 vereditos e exige prova de vulnerabilidade (PoV) para correções.
applies_to_roles: [security, verifier]
---

# Skill: Secure Code Audit & SARIF Triage

## Regras Obrigatórias
1. **Verificação contra o código-fonte:** Leia o código real e o fluxo de dados (source → sink) antes de classificar qualquer achado SARIF de Gitleaks, Opengrep/Semgrep, Trivy ou OSV-Scanner.
2. **Modelo de 3 Vereditos:** Classifique cada achado estritamente em:
   - `confirmed`: vulnerabilidade explorável ou segredo real confirmado no fluxo;
   - `false_positive`: mitigado por sanitização/controle comprovado ou código inatingível;
   - `unknown`: contexto insuficiente para afirmar com segurança (nunca disfarçar dúvida como certeza).
3. **Degradação Transparente:** Se algum scanner reportou `skipped_missing_binary`, destaque a lacuna no resumo sem mascarar o resultado como "100% limpo".
4. **Prova de Correção (PoV):** Para vulnerabilidades críticas/altas de lógica ou segurança, valide a correção com um teste que falha no código vulnerável e passa após o patch.
