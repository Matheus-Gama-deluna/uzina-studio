---
name: brownfield-archaeology
description: Executa diagnóstico técnico somente-leitura em repositórios existentes e calcula o Scorecard de Maturidade (0-100).
applies_to_roles: [architect, discovery]
---

# Skill: Brownfield Archaeology (Modo `plan` Somente-Leitura)

## Regras Obrigatórias
1. **Somente leitura:** Nunca edite arquivos nem execute comandos mutantes durante o diagnóstico.
2. **Mapeamento objetivo:** Inspecione estrutura de pastas, manifestos (`package.json`, `pyproject.toml`, etc.), schemas de banco, rotas/APIs, suíte de testes existente e configuração de CI.
3. **Scorecard de Maturidade (0–100):** Avalie objetivamente 5 dimensões (20 pts cada): CI/Verify ativo, Cobertura e qualidade de testes, Documentação/Steering, Postura de segurança (via `security-engine`) e Arquitetura/Modularidade.
4. **Rede de segurança:** Identifique módulos críticos sem testes e recomende a estratégia `characterization_strangler` quando houver alto risco de regressão.
