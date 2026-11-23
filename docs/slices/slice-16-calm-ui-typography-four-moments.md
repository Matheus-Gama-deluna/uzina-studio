# Slice 16 — Redesign Visual Calmo (90/10), Tipografia Confortável (`A- | A | A+`) & Arquitetura em 4 Momentos Dedicados

- **Status:** Concluído
- **Branch:** `feat/slice-16-calm-ui-typography-four-moments`
- **Referências Visuais:** Linear, Lovable, Vercel v0 e Claude Artifacts.

## 1. Problemas Resolvidos

1. **Sobrecarga de 5 momentos na mesma página (`/app`):** Divisão clara em 4 momentos dedicados na navegação principal:
   - `Ideias & Projetos` (`/app/ideas`)
   - `Chat da Engenharia` (`/app`)
   - `Estúdio Visual` (`/app/studio`)
   - `Entregas & Docs` (`/app/deliverables`)
2. **Micro-tipografia e falta de zoom:** Corpo de texto elevado para `14px–15px` (`text-sm` / `text-[15px]`) e controle global **`A- | A | A+`** (`compact` `14.5px`, `comfortable` `16px`, `large` `18px`) via `data-font-scale` no `<html>`.
3. **Poluição visual de laranja:** Disciplina **90/10** (90%+ monocromático neutro grafite/branco com bordas hairline `1px`; status com ponto discreto `6px` + texto neutro; âmbar reservado para no máximo **1 CTA primário por tela**).
4. **Estúdio Visual sufocado:** Página dedicada em tela ampla com alternância `Desktop | Tablet (640px) | Celular (390px)`, painel de direção retrátil e aba secundária limpa para `Referências, Moodboard & Stitch`.

## 2. Critérios de Pronto (DoD)

- [x] `node scripts/check-no-ee.mjs` -> `0`
- [x] `node scripts/audit-tests.mjs` -> `65 arquivos | 199 testes | 0 violações`
- [x] `pnpm --filter @uzina/web typecheck` e `lint` -> `0` erros
- [x] `pnpm --filter @uzina/web test -- tests/contract-drift.test.ts` -> `1 passed`
- [x] `pnpm --filter @uzina/web build` e `pnpm --filter @uzina/web test:e2e` -> `2 passed`
- [x] Validação visual no `browser` (Desktop `1440×900` Dark/Light + escala `A+`, Mobile `390×844`) nos 4 momentos (`0` erros de console/hidratação pós-reload, `0` HTTP `>= 500`, `0` overflow horizontal).
