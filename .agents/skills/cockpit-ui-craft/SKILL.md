---
name: cockpit-ui-craft
description: >-
  Padroniza o design e implementacao de interfaces web no Uzina Studio (Tailwind CSS v4, Radix/shadcn,
  Next.js App Router, MSW) eliminando erros comuns de UI gerada por IA ("AI slop"). Use antes e durante
  a criacao de qualquer tela, layout, design token ou componente em apps/web ou packages/ui.
---

# Skill: Cockpit UI Craft (Anti-"AI Slop")

Inspirada em **Anthropic `frontend-design`**, **`pbakaus/impeccable`** e **Vercel `web-design-guidelines` / `react-best-practices`**.

---

## Passo Obrigatório Antes de Escrever JSX

1. **Leia `.uzina/DESIGN.md`:** use exclusivamente os tokens semânticos OKLCH e a anatomia da casca definida para `/app/*` (Técnico) ou `/exec/*` (Executivo).
2. **Declare mentalmente em 3 linhas antes de codar:**
   - Qual a hierarquia primária da tela (1 ação principal por região)?
   - Como os 5 estados (*Empty, Sparse, Dense, Loading, Error*) serão renderizados?
   - Quais elementos podem ser exibidos em borda `1px` plana sem criar *card-itis*?

---

## Regras Arquiteturais de Stack (Next.js + Tailwind v4 + Radix/shadcn)

1. **Tailwind CSS v4 CSS-First (Sem `tailwind.config.js`):**
   - Declare tokens de cor, tipografia e espaçamento em `apps/web/src/app/globals.css` usando `@import "tailwindcss";` e `@theme inline { ... }` mapeando as variáveis OKLCH de `.uzina/DESIGN.md`.
   - Suporte alternância Dark (padrão) / Light via classe `.light` ou atributo `data-theme="light"` (respeitando preferência salva sem flash de tema).
2. **Componentes Radix / shadcn Modernos:**
   - Use `data-slot="..."` para estilização estrutural em componentes reutilizáveis (padrão React 19 sem `forwardRef` legado desnecessário).
   - Equalize o peso dos ícones ao texto adjacente (`size-4`, `strokeWidth={1.75}`).
3. **Server Components por Padrão + Sem Waterfalls:**
   - Casca de layout, Sidebar e leitura inicial de dados vivem em React Server Components (`Promise.all(...)` para fetches paralelos e `<Suspense fallback={<Skeleton />}>` para streams lentos).
   - Empurre `'use client'` apenas para folhas interativas (Kanban drag/drop, filtros, modais, formulários, Drawer Co-piloto).
   - Nunca passe objetos completos com campos sensíveis do banco para Client Components; filtre pelo DTO de `@uzina/contracts`.
4. **MSW Dual (Node + Browser) & Contract Drift Zero:**
   - Handlers mock ficam exclusivamente em `apps/web/src/mocks/`, alimentados pelos schemas Zod de `@uzina/contracts`.
   - É **proibido** colocar arrays mockados hardcoded ou `if (isMock)` dentro de componentes React.
   - Use `setupServer` para testes/SSR e `setupWorker` para desenvolvimento visual no browser (`onUnhandledRequest: "bypass"`).

---

## Regras de Excelência Visual e UX Operacional

- **Proibido "AI Slop":** zero gradientes roxo/neon, zero sombras pesadas empilhadas, zero emojis em títulos/CTAs, zero setas `→` genéricas em todos os botões.
- **Precisão Numérica:** aplique `tabular-nums` em todo número dinâmico (custos, tokens, contadores, timestamps, latência).
- **Keyboard-First & A11y (WCAG 2.1 AA):**
  - Todo elemento clicável é `<button>` ou `<a>` com `focus-visible` nítido.
  - Todo input possui `<label htmlFor>` + `aria-describedby`/`aria-invalid` em erros; botões só com ícone exigem `aria-label`.
  - Suporte atalhos globais de produtividade (`Cmd+K`/`Ctrl+K` para busca/comando rápido, `Esc` para fechar modais/drawers).
- **Optimistic UI & Anti-Duplo-Submit:** use `useActionState` / `useOptimistic` do React 19 com estado `pending` visível e rollback em erro.
