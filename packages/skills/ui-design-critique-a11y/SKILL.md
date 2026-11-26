---
name: ui-design-critique-a11y
description: Use quando precisar executar crítica visual independente e auditoria de acessibilidade WCAG 2.1 AA sobre protótipos ou UIs implementadas, validando os 5 estados, Heurísticas de Nielsen, 390px e vazamento visual de RBAC.
applies_to_roles: [visual, verifier]
phase: visual
role_category: critique
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca aprove protótipo ou interface web sem verificar em passo separado de contexto limpo todos os 5 estados de dados, contraste WCAG 2.1 AA, zero overflow em 390px, touch targets >= 44px e ocultação de ações proibidas ao RBAC.
---

# Skill: UI Design Critique & Accessibility Audit (Fresh-Context)

## Iron Law

> **Nunca aprove um protótipo ou interface entregue sem auditar em passo separado (contexto limpo) os 5 estados de dados, contraste WCAG 2.1 AA, ausência de overflow horizontal em `390x844`, *touch targets* $\ge 44\times 44\text{px}$ e zero vazamento visual de ações restritas por RBAC.**

Esta skill atua exclusivamente no papel avaliador (`critique`): ela **reprova ou aprova** com evidências objetivas antes do Portão Visual humano ou do merge.

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - Protótipo `vN` + `PrototypeComponentManifest` produzidos por `visual-design-md`, ou tela implementada em `apps/web` com Playwright/axe-core disponível.
  - Consulta a `.uzina/DESIGN.md` via `read_design_system_contract` e `validate_color_contrast_and_tokens`.
- **Exit Artifact (Saída Imutável):**
  - Veredito de crítica (`approved | changes_required`) detalhando falhas por critério (Hierarquia, 5 Estados, WCAG 2.1 AA, Mobile `390px`, RBAC Visual e Aderência a `packages/ui`) conforme `references/nielsen-wcag-5states.md`.

## Protocolo

### Step 0 — Isolamento de Contexto e Baseline do Contrato
1. Leia `.uzina/DESIGN.md` via `read_design_system_contract` sem assumir que o gerador seguiu os tokens.
2. Execute `validate_color_contrast_and_tokens` sobre os pares de cor declarados no protótipo/CSS.

### Step 1 — Auditoria dos 5 Estados, Hierarquia e Heurísticas de Nielsen
1. Confirme presença real (não apenas texto comentando) dos estados `loading`, `empty`, `error`, `partial` e `populated`.
2. Verifique hierarquia visual (clareza da ação primária, uso de `tabular-nums` em números, ausência de "AI slop" decorativo).
3. Avalie aderência às Heurísticas de Nielsen: visibilidade do status do sistema, prevenção de erros em ações destrutivas, feedback imediato e consistência com `packages/ui`.

### Step 2 — Auditoria WCAG 2.1 AA, Mobile 390px e RBAC Visual
1. Carregue `references/nielsen-wcag-5states.md` e verifique teclado (`focus-visible`, navegação por `Tab`/`Escape` em modais), labels semânticos (`aria-label`/`label`), contraste ($\ge 4.5:1$ / $3:1$), e área de toque $\ge 44\times 44\text{px}$ em `390x844` sem scroll horizontal.
2. Confirme que ações administrativas/destrutivas não ficam visíveis ou habilitadas para perfis sem permissão (`auditor`).

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "O contraste ficou perto de 4.2:1, visualmente dá para ler." | Viola WCAG 2.1 AA (`4.5:1`) e falha automaticamente no `axe-core`. | Reprove e indique o token de maior contraste do `.uzina/DESIGN.md`. |
| "Só testei no viewport desktop 1440px." | Mobile `390px` frequentemente sofre corte lateral ou botões menores que `44px`. | Exija verificação explícita em `390x844` e `1440x900`. |
| "O protótipo não mostra estado de erro, mas o usuário entende." | Falhas silenciosas ou telas brancas geram bloqueio operacional em produção. | Bloqueie até que `empty` e `error` recuperável sejam incluídos. |
| "O botão de apagar aparece para todos, mas a API bloqueia com 403." | Gera UX frustrante e expõe superfícies administrativas a papéis somente-leitura. | Exija ocultação ou bloqueio contextual coerente com o RBAC no `PrototypeComponentManifest`. |

## Ponteiros Progressivos

- Carregue [references/nielsen-wcag-5states.md](references/nielsen-wcag-5states.md) como checklist completo de reprovação/aprovação antes de emitir o veredito final.
