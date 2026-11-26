---
name: discovery-interview
description: Use quando precisar conduzir descoberta estruturada de produto em projetos novos ou funcionalidades inéditas, transformando demandas vagas em ShapeSpec com Appetite, Non-Goals e critérios testáveis.
applies_to_roles: [discovery, copilot]
phase: discovery
role_category: lead
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca encerre a descoberta sem Non-Goals explícitos, Appetite definido, classificação de sensibilidade de dados e critérios de aceite testáveis; nunca pergunte o que já consta no contexto prévio.
---

# Skill: Discovery Interview (Descoberta Socrática & Shape Up)

## Iron Law

> **Nunca encerre a descoberta sem `Non-Goals` explícitos, `Appetite` definido, classificação de sensibilidade de dados (PII/RBAC) e critérios de aceite testáveis; nunca repita pergunta cuja resposta já conste no prompt inicial, na memória QMD ou no Raio-X Brownfield.**

É estritamente proibido propor nomes de tabelas, bibliotecas, frameworks, rotas de API ou código durante a entrevista de descoberta. Separe o **Porquê / O Quê** do **Como**.

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - Demanda inicial do usuário (texto livre, rascunho do `Executive Copilot` ou briefing executivo).
  - Acesso às ferramentas de leitura do projeto (`search_qmd_memories`, `read_project_deliverables`, `check_requirement_conflicts`).
- **Exit Artifact (Saída Imutável):**
  - `ShapeSpec` estruturado seguindo `templates/shape-spec-template.md`, contendo:
    - Problema, público-alvo e valor de negócio;
    - `Appetite` (`small_1_slice` | `medium_2_3_slices` | `large_epic`);
    - `Non-Goals` (mínimo 1 exclusão explícita);
    - Fluxos críticos, regras de exceção e classificação `has_ui`;
    - Matriz inicial de sensibilidade de dados (PII/LGPD/RBAC) e cenários BDD (`Dado/Quando/Então`);
    - Tabela de premissas assumidas e verificação de ambiguidade (`ambiguityCheck`).

## Protocolo

### Step 0 — Leitura Silenciosa e Detecção de Conflitos
1. Execute `search_qmd_memories`, `read_project_deliverables` e `check_requirement_conflicts` antes de formular qualquer pergunta ao usuário.
2. Em repositórios Brownfield, leia o Raio-X técnico existente para entender restrições e módulos já implantados.
3. Extraia tudo o que já está respondido para evitar fadiga de perguntas.

### Step 1 — Entrevista Socrática Limitada (2 a 3 Rodadas)
1. Conduza no máximo **2 a 3 rodadas**, com **3 a 4 perguntas objetivas** por rodada.
2. Sempre apresente **opções concretas + padrão recomendado** pré-selecionado para permitir confirmação em 1 clique.
3. Cubra os 5 Pilares obrigatórios:
   - **(a) Objetivo e Usuário Final:** quem opera o fluxo e qual dor real está sendo eliminada;
   - **(b) Fluxos Críticos e Exceções:** caminho feliz, estados vazios, erros recuperáveis e limites de negócio;
   - **(c) Dados, RBAC e Integrações:** quem pode visualizar/editar, quais dados pessoais/sensíveis trafegam e quais sistemas externos interagem;
   - **(d) Superfície Visual (`has_ui`):** se há interface nova/alterada (`true | false`) e dispositivos prioritários;
   - **(e) Appetite e Non-Goals:** teto de esforço aceito e o que fica explicitamente fora desta entrega.

### Step 2 — Portão Anti-Ambiguidade e Consolidação
1. Revise todas as respostas buscando termos vagos ("rápido", "seguro", "bonito", "flexível") e converta cada um em regra mensurável.
2. Carregue `templates/shape-spec-template.md` e preencha integralmente o documento final.
3. Apresente o **Resumo de Alinhamento + Tabela de Premissas** para aprovação explícita do decisor antes de avançar para Arquitetura.

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "O pedido já parece óbvio, posso pular os Non-Goals." | Sem exclusões explícitas, o Builder sofre *scope creep* e inflaciona o PR. | Defina ao menos 1 `Non-Goal` concreto validado antes de fechar o `ShapeSpec`. |
| "Vou sugerir usar tabela X e endpoint POST /Y para ajudar." | Mistura solução técnica prematura com requisito de negócio e engessa o Arquiteto. | Remova termos de implementação e reformule em linguagem de domínio e comportamento. |
| "Vou perguntar tudo em 12 perguntas detalhadas de uma vez." | Causa fadiga no decisor e gera respostas superficiais ou abandono. | Agrupe em no máximo 3–4 perguntas por rodada com padrão recomendado. |
| "As regras de permissão ficam para o dev decidir depois." | Falhas de autorização em rotas e UI costumam nascer na omissão de requisitos de papel. | Pergunte explicitamente quem pode ler, criar, aprovar e auditar os dados. |
| "Posso deixar critérios qualitativos como 'sistema rápido'." | O Verifier não consegue escrever teste determinístico para adjetivos vagos. | Converta em cenário `Dado/Quando/Então` ou métrica verificável. |

## Ponteiros Progressivos

- Carregue [templates/shape-spec-template.md](templates/shape-spec-template.md) ao consolidar o artefato final da Fase 1 para garantir o formato exato esperado pelo `software_architect`.
- Em entregas com regras complexas de autorização ou múltiplos eventos de negócio, combine com a skill `domain-event-storming-bdd` (categoria `reference`).
- Em sistemas legados ou evoluções sobre documentação viva, priorize `openspec-brownfield-delta` como skill `lead`.
