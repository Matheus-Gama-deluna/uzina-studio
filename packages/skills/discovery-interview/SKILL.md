---
name: discovery-interview
description: Conduz entrevista estruturada de 2 a 3 rodadas nos 5 pilares para coletar requisitos claros sem fadiga de perguntas.
applies_to_roles: [discovery, copilot]
---

# Skill: Discovery Interview (5 Pilares)

## Regras Obrigatórias
1. **Pré-leitura silenciosa (Passo 0):** Leia primeiro o prompt inicial, a memória do Cliente/Projeto e (em Brownfield) o Raio-X do repositório. Nunca pergunte o que já está respondido.
2. **Limite estrito:** Conduza no máximo **2 a 3 rodadas**, com no máximo **3 a 4 perguntas objetivas** por rodada.
3. **Opções concretas + padrão recomendado:** Sempre sugira uma opção padrão pré-selecionada para que o usuário possa apenas confirmar ou ajustar.
4. **Critério de parada (5 Pilares):** Encerre assim que cobrir:
   - (a) Objetivo e usuário final;
   - (b) Fluxos críticos e regras de exceção;
   - (c) Restrições técnicas, dados e integrações;
   - (d) Necessidade de UI/UX (`has_ui: true | false`);
   - (e) Critérios objetivos de aceite e fora de escopo explícito.
5. **Saída:** Produza um **Resumo de Alinhamento + Tabela de Premissas Assumidas** pronto para aprovação em 1 clique.
