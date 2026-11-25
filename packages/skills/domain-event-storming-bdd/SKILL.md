---
name: domain-event-storming-bdd
description: Use quando precisar modelar eventos de domínio, atores, políticas e gerar cenários Gherkin (Dado/Quando/Então) com matriz de permissões RBAC e classificação LGPD/PII na Fase 1.
applies_to_roles: [discovery]
phase: discovery
role_category: reference
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca entregue requisitos com múltiplos atores ou transições de estado sem mapear eventos de domínio, invariantes de autorização (RBAC), dados pessoais (LGPD) e ao menos um cenário Dado/Quando/Então por regra crítica.
---

# Skill: Domain Event Storming & BDD / RBAC Matrix

## Iron Law

> **Nunca feche uma especificação de domínio com múltiplos atores ou mudanças de estado sem mapear explicitamente os Eventos de Domínio, Políticas de Exceção, Matriz RBAC/LGPD e cenários `Dado / Quando / Então` testáveis.**

Cada regra de negócio crítica deve ser traduzida em comportamento observável independente de banco de dados ou framework.

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - Contexto da demanda e `discovery-interview` (ou `openspec-brownfield-delta`) em andamento.
  - Consulta prévia às memórias de domínio (`search_qmd_memories`, categoria `domain_rule`).
- **Exit Artifact (Saída Imutável):**
  - Mapa leve de **Comandos → Eventos de Domínio → Políticas → Projeções**;
  - Matriz **RBAC × LGPD/PII** e tabela de cenários BDD (`Dado/Quando/Então`) seguindo `templates/bdd-rbac-matrix.md`.

## Protocolo

### Step 0 — Leitura Silenciosa das Regras de Domínio Existentes
1. Execute `search_qmd_memories` filtrando regras de domínio anteriores e consulte `check_requirement_conflicts` para evitar contradição com fluxos já implantados.
2. Liste os papéis organizacionais envolvidos (`owner`, `admin`, `developer`, `auditor` ou perfis finais do produto).

### Step 1 — Event Storming Enxuto (Ator → Comando → Evento → Política)
1. Identifique cada **Comando** disparado por um ator humano ou automação.
2. Nomeie o **Evento de Domínio** resultante no passado (ex.: `EntregávelAprovado`, `ChaveRotacionada`).
3. Para cada evento, registre a **Política / Invariante** que o bloqueia ou dispara a próxima reação (ex.: *"Se `verifyPassed === false`, bloquear aprovação"*).

### Step 2 — Cenários BDD e Matriz RBAC / LGPD
1. Carregue `templates/bdd-rbac-matrix.md` e preencha:
   - Cenários positivos e **negativos** (`Dado / Quando / Então`) ligados ao papel exigido (`roleRequired`);
   - Classificação de dados sensíveis (`PII`, credenciais, logs de auditoria, retenção/mascaramento).

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "Só escrevi os cenários do caminho feliz porque o erro é óbvio." | Regras de bloqueio e bordas `403/422` costumam ser implementadas errado sem BDD negativo. | Adicione cenário `Dado/Quando/Então` explícito para falha de permissão e estado inválido. |
| "Todos os usuários logados podem ver os mesmos campos." | Vaza PII ou ações administrativas para perfis somente-leitura como `auditor`. | Preencha a matriz RBAC × Sensibilidade em `templates/bdd-rbac-matrix.md`. |
| "Usei nomes de métodos e tabelas no `Quando` do Gherkin." | Acopla o critério de aceite à implementação e quebra testes se o módulo mudar. | Reescreva em termos de intenção do ator e resultado observável no domínio. |

## Ponteiros Progressivos

- Carregue [templates/bdd-rbac-matrix.md](templates/bdd-rbac-matrix.md) para estruturar a matriz RBAC/LGPD e os cenários BDD compatíveis com `ShapeSpecSchema`.
- Envie os cenários validados de volta ao fluxo `discovery-interview` para aprovação final do usuário.
