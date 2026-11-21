---
trigger: model_decision
description: "Ativar ao criar, refatorar ou revisar telas, layouts, CSS, tokens de design, handlers MSW ou componentes React em apps/web/ e packages/ui/."
---

# Regras de Qualidade Visual e UI Craft — Uzina Studio

Ao atuar em qualquer interface web do **Uzina Studio** (`apps/web/**` ou `packages/ui/**`):

1. **Contrato Visual Obrigatório:** Leia [`.uzina/DESIGN.md`](../../.uzina/DESIGN.md) e [`.agents/skills/cockpit-ui-craft/SKILL.md`](../skills/cockpit-ui-craft/SKILL.md) **antes** de escrever CSS ou JSX.
2. **Zero "AI Slop":** Proibido gradientes roxo/neon decorativos, *card-itis* (sombras pesadas em cards aninhados), emojis decorativos em títulos/botões, ou dados mockados hardcoded fora de `apps/web/src/mocks/` (MSW).
3. **5 Estados Obrigatórios:** Toda view conectada a dados deve cobrir explicitamente *Empty*, *Sparse*, *Dense*, *Loading Skeleton* (`CLS = 0`) e *Error com retry*, além de `tabular-nums` em valores numéricos.
4. **QA Visual Obrigatório:** Após implementar ou alterar telas, execute o protocolo de 4 passes definido em [`.agents/skills/ui-visual-qa-critic/SKILL.md`](../skills/ui-visual-qa-critic/SKILL.md) usando o subagente `browser` (`Model: "flash"`) em Desktop (`1280×800`), Mobile (`390×844`) e alternância Dark/Light antes de concluir.
