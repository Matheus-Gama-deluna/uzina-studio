---
trigger: model_decision
description: "Ativar ao projetar, implementar ou depurar agentes, workflows, tools, redes de agentes (Agent Networks) ou memoria com Mastra Core."
---

# Regras do Dominio Mastra Core (Licenca Apache 2.0 Estrita)

1. **Conformidade Apache 2.0 (Zero `ee/`)**:
   - Todo pacote Mastra utilizado deve ser open-source sob licenca Apache 2.0.
   - E estritamente proibido importar qualquer subcaminho `/ee` (`@mastra/*/ee`). Recursos corporativos como RBAC, trilhas de auditoria e limites de cota devem ser implementados na propria camada de dominio da fabrica usando **Better Auth** e **Drizzle ORM**.
2. **Contratos de Tools e Workflows**:
   - Toda tool (`createTool`) e todo passo de workflow (`createStep`) deve ter `inputSchema` e `outputSchema` declarados com **Zod**.
   - Tratamento de erros dentro de steps de workflow deve classificar falhas em *retriable* (rate limit, rede transitoria) vs. *fatal* (erro de validacao, violacao de seguranca).
3. **Roteamento Economico de Modelos dentro da Fabrica**:
   - Agentes internos da fabrica devem receber configuracao de modelo desacoplada por tarefa (permitindo usar modelos leves/rapidos para indexacao, resumo de contexto e triagem, e modelos fortes para arquitetura e sintese de codigo).
