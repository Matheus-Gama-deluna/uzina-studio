# Template: ShapeSpec (Fase 1 — Descoberta)

## 1. Identificação e Appetite
- **Título da Entrega:** `<nome claro da funcionalidade>`
- **Appetite (Teto de Esforço):** `small_1_slice` | `medium_2_3_slices` | `large_epic`
- **Superfície Visual (`has_ui`):** `true` | `false`
- **Origem:** `greenfield` | `brownfield`

## 2. Problema, Público e Resultado Esperado
- **Quem usa (Personas/Papéis):** `<ex.: owner, admin, developer, auditor>`
- **Dor atual / Oportunidade:** `<descrição objetiva sem jargão técnico>`
- **Resultado de negócio mensurável:** `<critério de sucesso observável>`

## 3. Non-Goals (Explicitamente Fora de Escopo)
- [ ] `<Item explicitamente excluído desta entrega para evitar scope creep>`
- [ ] `<Integração, relatório ou automação adiada para ciclo futuro>`

## 4. Fluxos Críticos, Exceções e Dados Sensíveis
| Fluxo | Regra de Negócio Principal | Caso de Exceção / Erro | Sensibilidade (PII/RBAC) |
| :--- | :--- | :--- | :--- |
| `<Fluxo 1>` | `<Comportamento esperado>` | `<O que ocorre se falhar>` | `<Papéis autorizados / Dados restritos>` |

## 5. Cenários de Aceite (BDD — Dado / Quando / Então)
### Cenário 1: `<Título objetivo>` (`roleRequired: <papel>`)
- **Dado** `<pré-condição de estado e autenticação>`
- **Quando** `<ação do ator>`
- **Então** `<resultado verificável e efeito colateral esperado>`

## 6. Premissas Assumidas & Ambiguity Check
| Premissa Assumida | Impacto se Mudar | Status |
| :--- | :--- | :--- |
| `<Premissa com padrão recomendado>` | `<Baixo / Médio / Alto>` | `Confirmada` / `Pendente` |

- **Ambiguity Score (0–100, quanto menor melhor):** `<0..100>`
- **Questões em Aberto:** `<lista vazia obrigatória antes do handoff>`
