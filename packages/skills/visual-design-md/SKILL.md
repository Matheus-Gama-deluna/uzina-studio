---
name: visual-design-md
description: Consolida Moodboard, tags de intenção e referências visuais em .uzina/DESIGN.md sem vendor lock-in.
applies_to_roles: [visual, architect]
---

# Skill: Visual Design Contract (`.uzina/DESIGN.md`)

## Regras Obrigatórias
1. **Consolidar intenções:** Respeite estritamente as tags de intenção do Moodboard (o que copiar vs. o que ignorar de cada referência).
2. **Contrato aberto:** Gere `.uzina/DESIGN.md` contendo: paleta semântica (tokens hex/CSS com contraste WCAG >= 4.5:1), escala tipográfica, espaçamento/densidade, layout de navegação, estados de componente (loading, empty, error, hover) e anti-padrões proibidos.
3. **Independência de ferramenta:** Não dependa de formato proprietário; o contrato deve ser diretamente implementável em Tailwind CSS / Radix pelo OpenCode.
