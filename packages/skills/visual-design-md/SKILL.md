---
name: visual-design-md
description: Use quando precisar criar ou evoluir .uzina/DESIGN.md e protótipos HTML na Fase 2.5, definindo direção estética intencional, tokens semânticos W3C, reutilização de packages/ui e os 5 estados obrigatórios de dados.
applies_to_roles: [visual, architect]
phase: visual
role_category: lead
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca produza protótipos ou especificações de UI com cores hex hardcoded fora dos tokens, sem os 5 estados de interface (loading, empty, error, partial, populated) ou sem validar contraste WCAG 2.1 AA e layout mobile 390px.
---

# Skill: Visual Design Contract (`.uzina/DESIGN.md` & Estúdio Visual)

## Iron Law

> **Nunca produza especificações visuais ou protótipos com cores hardcoded fora de tokens semânticos, omitindo qualquer um dos 5 estados de dados (`loading`, `empty`, `error`, `partial`, `populated`), ou sem validar contraste WCAG 2.1 AA e ausência de scroll horizontal em `390px`.**

Todo componente de interface deve mapear primeiro para primitivas já existentes em `packages/ui` (`data-slot`) antes de propor novos componentes.

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - `ShapeSpec` (`has_ui: true`) e `ArchitectBlueprintV2` aprovados.
  - Consulta obrigatória ao contrato vigente (`read_design_system_contract`) e protótipos anteriores (`inspect_prototype_version`).
- **Exit Artifact (Saída Imutável):**
  - `.uzina/DESIGN.md` consolidado com tokens semânticos W3C/OKLCH, tipografia, ritmo espacial `4/8px` e regras anti-"AI slop";
  - Protótipo HTML sanitizado (`vN`) cobrindo os 5 estados de interface e os fluxos JTBD da entrega;
  - `PrototypeComponentManifest` mapeando seções da tela aos componentes reais de `packages/ui`, pronto para auditoria de `ui-design-critique-a11y`.

## Protocolo

### Step 0 — Leitura Silenciosa do Design System e Versões Prévias
1. Execute `read_design_system_contract` para ler `.uzina/DESIGN.md`, tokens atuais e o catálogo de componentes de `packages/ui`.
2. Se houver versões anteriores do protótipo, chame `inspect_prototype_version` para preservar decisões aprovadas e evitar regressões.
3. Consulte `read_project_deliverables` para alinhar o fluxo **Jobs-to-be-Done (JTBD)** aos papéis RBAC da entrega.

### Step 1 — Direção Estética Intencional (Anti-"AI Slop")
1. Defina explicitamente a hierarquia visual, densidade da superfície (`exec/*` vs `app/*`), escala tipográfica (com `tabular-nums` para métricas) e ritmo espacial em múltiplos de `4px`/`8px`.
2. Elimine clichês visuais genéricos (gradientes roxos gratuitos, excesso de sombras difusas, cards decorativos sem função operacional).
3. Garanta que ações e dados visíveis no protótipo respeitem o escopo de papel (RBAC) definido no `ShapeSpec`.

### Step 2 — Os 5 Estados, Responsividade 390px e Validação de Contraste
1. Projete e declare explicitamente os **5 estados**: `loading` (skeleton fiel), `empty` (estado vazio com CTA acionável), `error` (mensagem recuperável com retry), `partial` (dados degradados/em progresso) e `populated`.
2. Execute `validate_color_contrast_and_tokens` para comprovar razão mínima `4.5:1` em texto normal e `3:1` em elementos grandes/controles.
3. Carregue `references/tokens-wcag-checklist.md` para conferir todos os requisitos antes de enviar à etapa separada de crítica (`ui-design-critique-a11y`).

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "Vou colocar `#6366f1` direto no estilo porque é só um protótipo." | Quebra a consistência de tema (claro/escuro) e gera retrabalho no Builder. | Mapeie exclusivamente tokens semânticos do `.uzina/DESIGN.md`. |
| "Os estados de erro e vazio o desenvolvedor adiciona depois." | Interfaces sem `empty` e `error` falham na primeira demo real ou silenciam falhas. | Inclua explicitamente os 5 estados no protótipo e no `PrototypeComponentManifest`. |
| "No desktop 1440px ficou ótimo, no mobile deve caber." | Tabelas e toolbars densas frequentemente quebram com overflow horizontal em `390px`. | Adapte navegação, *touch targets* ($\ge 44\times 44\text{px}$) e empilhamento para `390px`. |
| "Vou desenhar um botão/modal customizado do zero." | Duplica comportamento acessível já resolvido em `packages/ui` e gera drift. | Reutilize primitivas de `packages/ui` listadas em `read_design_system_contract`. |

## Ponteiros Progressivos

- Carregue [references/tokens-wcag-checklist.md](references/tokens-wcag-checklist.md) durante a criação de tokens e revisão dos 5 estados antes do handoff.
- Submeta o protótipo gerado para revisão em contexto separado usando a skill `ui-design-critique-a11y` (categoria `critique`).
