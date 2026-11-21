# ADR-003: Design System Dual-Theme OKLCH, Tailwind CSS v4 e Protocolo Anti-"AI Slop"

* **Status:** Aceita
* **Data:** 2026-11-21
* **Contexto de Origem:** Preparação de Capacidades de UI/UX antes do Slice 1

## Contexto
Interfaces web geradas por IA frequentemente sofrem de problemas recorrentes (*"AI slop"*): gradientes roxos/neon decorativos, *card-itis* (pilhas de cards com sombras pesadas), ausência de estados *empty/loading/error*, trepidação de números em tabelas/dashboards sem `tabular-nums`, contraste insuficiente e mocks hardcoded dentro de componentes React. Como o **Slice 1** inicia a construção das telas reais do cockpit do **Uzina Studio** (Sidebar Hierárquica, Kanban, Lista e Configurações de Provedor), era necessário travar um contrato visual aberto e regras executáveis antes de escrever JSX.

## Decisão
1. **Direção Visual Oficial (`.uzina/DESIGN.md`):**
   * **Precision Industrial Dark** como tema padrão (superfícies grafite neutras em **OKLCH**, bordas hairline de `1px`, acento funcional único em **Âmbar/Cobre Uzina**), acompanhado de **Crisp Light** completo via alternância de tema.
   * Uso obrigatório de `tabular-nums` em valores financeiros, tokens, contadores, timestamps e latências.
2. **Stack de Estilização & Componentes:**
   * **Tailwind CSS v4 (CSS-first)** com tokens mapeados em `apps/web/src/app/globals.css` via `@theme inline` (sem `tailwind.config.js`).
   * **Radix UI / shadcn moderno** com `data-slot` e React Server Components na casca do cockpit, isolando `'use client'` nas folhas interativas.
   * **MSW dual (`setupServer` + `setupWorker`)** em `apps/web/src/mocks/` derivado dos schemas de `@uzina/contracts` (proibido mocks hardcoded em componentes).
3. **Governança Contínua:**
   * Criadas as skills `.agents/skills/cockpit-ui-craft/SKILL.md` e `.agents/skills/ui-visual-qa-critic/SKILL.md` (4 passes: *Audit → Critique → Polish → Distill*) e a regra de ativação `.agents/rules/ui-craft-standards.md`.
   * Atualizada `.agents/skills/dual-surface-cockpit/SKILL.md` e `AGENTS.md` referenciando o contrato `.uzina/DESIGN.md`.

## Consequências
* **Positivas:** Consistência visual entre todos os Slices (1 a 6), zero vendor lock-in de prototipagem, acessibilidade WCAG 2.1 AA por padrão e critérios objetivos de QA visual no `browser` e Playwright.
* **Trade-offs:** Exige manter tokens sincronizados para os dois temas (Dark e Light) e validar ambos na matriz de QA visual a cada nova tela.
