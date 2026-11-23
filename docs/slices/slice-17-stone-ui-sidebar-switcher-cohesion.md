# Slice 17 — Sistema Visual Stone (4 Degraus), Navegação por Jornada com `Project Switcher` & Coesão Global

- **Status:** Concluído
- **Branch:** `feat/slice-17-stone-ui-sidebar-switcher-cohesion`
- **Referências Visuais:** Claude, Notion, Linear, Vercel Geist, Lovable e Devin.

## 1. Objetivos & Decisões Alinhadas (`/grill-me`)

1. **Sistema Visual Warm Stone em 4 Degraus (`globals.css` + `.uzina/DESIGN.md`):**
   - Escada tonal Stone (`hue 65–75`) no Dark (`canvas → sidebar → surface → elevated`, com `--bg-inset` limpo) e no Light (`canvas` areia suave → `sidebar` → `surface` branco puro com micro-sombra → `elevated`, inputs claros), mantendo laranja âmbar cirúrgico (`1 CTA primário/tela`).
2. **Nova Sidebar com `Project Switcher` + Trilha de Jornada:**
   - Seletor `Project Switcher` no topo da sidebar (`data-testid="sidebar-project-switcher"`), Grupo `Projeto Ativo` em 5 etapas com indicadores sutis (`✓` / `●` / contador / pendências) e Grupo recolhível `Fábrica & Sistema`.
   - `Co-piloto Executivo` reposicionado como atalho discreto no header (`⌘K` / botão-ícone compacto) sem competir com o Chat da Engenharia.
3. **Chat sem Scroll Duplo & Faxina de Redundâncias:**
   - Correção de altura flexível em `/app` (`0` scroll duplo em `1440×900` Dark e Light), remoção de selects de projeto e botões `← Chat` / `← Voltar ao Chat` duplicados, e substituição da barra redundante de chips no Chat por 1 próximo passo guiado.
4. **Unificação Visual das 5 Páginas Operacionais (`/app/memories`, `/app/providers`, `/app/finops`, `/app/decisions`, `/app/security`):**
   - Container `max-w-6xl`, tipografia mínima `>= 12px` (`text-xs` / `text-sm`), no máximo 1 CTA âmbar por página, criação de memória via modal sob demanda, medição manual recolhível no FinOps e cards neutros em Provedores.

## 2. Critérios de Pronto (DoD)

- [x] `node scripts/check-no-ee.mjs` -> `0`
- [x] `node scripts/audit-tests.mjs` -> `65 arquivos | 199 testes | 0 violações`
- [x] `pnpm --filter @uzina/web typecheck` e `lint` -> `0` erros
- [x] `pnpm --filter @uzina/web test -- tests/contract-drift.test.ts` -> `1 passed`
- [x] `pnpm --filter @uzina/web build` e `pnpm --filter @uzina/web test:e2e` -> `2 passed`
- [x] QA visual multi-viewport (`browser`) em Desktop `1440×900` (Dark Stone + Light Stone + `A+` + `page.reload()`) e Mobile `390×844` em todas as 9 rotas (`0` erros de console/hidratação, `0` HTTP `>= 500`, `0` overflow horizontal, `Enviar Mensagem` em `y + h = 867.2px <= 900`).
