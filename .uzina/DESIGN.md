# Contrato Visual Oficial — Uzina Studio (`.uzina/DESIGN.md`)

> **Direção Estética:** *Calm Precision Dark (padrão)* + *Crisp Light (alternância)* — inspirado em Linear, Lovable, Claude Artifacts e Vercel. Superfícies neutras em **OKLCH**, disciplina cromática **90/10** (90%+ neutro monocromático + **no máximo 1 CTA primário com preenchimento Âmbar/Cobre por tela**), bordas hairline de `1px`, zero badges coloridos empilhados em excesso e tipografia confortável com controle global de escala (`A- | A | A+`).
> **Implementação Alvo:** Tailwind CSS v4 (CSS-first `@theme` em `apps/web/src/app/globals.css`, sem `tailwind.config.js`) + Radix UI / shadcn moderno (`data-slot`, sem `forwardRef` legado).

---

## 1. Tokens Semânticos em OKLCH (Warm Stone 4 Degraus · Dual-Theme)

| Token CSS | Papel Visual | Warm Stone Dark (Padrão) | Warm Stone Light (Alternância) |
| :--- | :--- | :--- | :--- |
| `--bg-canvas` | Fundo global da aplicação (degrau 0) | `oklch(0.155 0.005 68)` | `oklch(0.955 0.006 75)` |
| `--bg-sidebar` | Barra lateral e topo (degrau 1) | `oklch(0.18 0.006 68)` | `oklch(0.972 0.005 75)` |
| `--bg-surface` | Painéis, cards e áreas de foco (degrau 2) | `oklch(0.205 0.006 68)` | `oklch(1 0 0)` |
| `--bg-elevated` | Item ativo, hover, menus (degrau 3) | `oklch(0.245 0.007 68)` | `oklch(0.978 0.004 75)` |
| `--bg-inset` | Inputs limpos, wells, blocos de código | `oklch(0.138 0.005 68)` | `oklch(0.992 0.003 75)` |
| `--border-subtle` | Divisórias internas `1px` | `oklch(0.27 0.007 68)` | `oklch(0.89 0.007 75)` |
| `--border-default` | Bordas padrão de painéis/inputs | `oklch(0.32 0.008 68)` | `oklch(0.83 0.009 75)` |
| `--border-strong` | Hover e delimitadores ativos | `oklch(0.42 0.01 68)` | `oklch(0.7 0.012 75)` |
| `--fg-primary` | Texto principal e títulos | `oklch(0.96 0.005 75)` | `oklch(0.18 0.01 68)` |
| `--fg-secondary` | Rótulos e descrições | `oklch(0.81 0.007 72)` | `oklch(0.41 0.012 68)` |
| `--fg-muted` | Metadados, placeholders, eixos | `oklch(0.64 0.008 70)` | `oklch(0.54 0.012 68)` |
| `--fg-disabled` | Estados desabilitados | `oklch(0.47 0.008 68)` | `oklch(0.7 0.008 70)` |
| `--accent` | Acento funcional **Âmbar/Cobre Uzina** | `oklch(0.71 0.16 52)` | `oklch(0.6 0.17 48)` |
| `--accent-hover` | Hover de ação primária | `oklch(0.76 0.15 52)` | `oklch(0.54 0.17 48)` |
| `--accent-subtle` | Fundo de item selecionado/ativo | `oklch(0.71 0.16 52 / 0.14)` | `oklch(0.6 0.17 48 / 0.12)` |
| `--accent-fg` | Texto sobre `--accent` | `oklch(0.15 0.02 52)` | `oklch(0.99 0.002 55)` |
| `--focus-ring` | Anel de foco teclado (`focus-visible`) | `oklch(0.75 0.15 52)` | `oklch(0.58 0.18 48)` |
| `--status-ok` | Verde operacional / aprovado | `oklch(0.74 0.15 155)` | `oklch(0.52 0.15 155)` |
| `--status-warn` | Atenção / aguardando decisão HITL | `oklch(0.78 0.15 80)` | `oklch(0.58 0.16 75)` |
| `--status-danger` | Falha / bloqueio / CVE crítico | `oklch(0.66 0.2 25)` | `oklch(0.55 0.21 25)` |
| `--status-info` | Em execução / streaming | `oklch(0.7 0.14 235)` | `oklch(0.54 0.16 240)` |
| `--status-neutral` | Arquivado / skipped | `oklch(0.64 0.008 70)` | `oklch(0.54 0.012 68)` |

* **Regra de Status:** nunca comunique status apenas por cor — combine sempre **cor semântica + ícone consistente + rótulo textual**.

---

## 2. Tipografia, Escala e Precisão Numérica

* **Família Sans (UI):** `Geist`, `Plus Jakarta Sans`, `system-ui`, `sans-serif`.
* **Família Mono (Código, Hashes, Logs, Valores):** `Geist Mono`, `JetBrains Mono`, `ui-monospace`, `monospace`.
* **Escala Fluida, Confortável e Ajustável (`data-font-scale`):**
  * Controle global no cabeçalho (`compact` = `14.5px`, `comfortable` = `16px` padrão, `large` = `18px`).
  * Page Title (`h1`): `clamp(1.375rem, 1.2rem + 0.6vw, 1.625rem)` (`font-semibold`, `tracking-[-0.02em]`).
  * Section Title (`h2`): `1rem` (`16px`, `font-semibold`).
  * Body / Chat / Leitura: `0.9375rem` (`15px`, `leading-7`) ou `0.875rem` (`14px`, `leading-6`).
  * Metadado / Kicker / Badge: mínimo `0.75rem` (`12px`, `font-medium`) — proibido micro-texto `9px–10px` em conteúdo de leitura.
* **Disciplina Cromática 90/10 (Fim da Poluição de Acento):**
  * No máximo **1 botão primário** (`bg-accent text-accent-fg`) por visão/tela.
  * Itens ativos de navegação usam superfície neutra elevada (`bg-elevated text-fg-primary border-border-subtle`), e badges de status usam ponto semântico discreto (`6px`) + texto neutro.
* **Obrigação de `tabular-nums`:** todo contador, custo em USD, consumo de tokens, duração/latência (`ms`/`s`), data UTC e coluna numérica de tabela deve usar `font-variant-numeric: tabular-nums` (`tabular-nums` no Tailwind) para eliminar trepidação visual (*layout jitter*).

---

## 3. Anatomia da Casca do Cockpit (Dual-Surface)

### A. Superfície Técnica (`/app/*`)
* **Sidebar Hierárquica (`240px`, colapsável em `< 1024px`):** seletor de Organização → Cliente (`"Internos"` destacado) → Projetos (+ badge Greenfield/Brownfield) + navegação principal (*Torre de Controle*, *Caixa de Decisões*, *Projetos*, *Segurança AppSec*, *Provedores & Cofre*).
* **Topbar Fixa (`48px`):** breadcrumb contextual, gatilho de paleta de comandos (`Cmd+K` / `Ctrl+K`), alternador Dark/Light e botão do **Drawer do Co-piloto Executivo**.
* **Área Principal (Container Query Ready):** densidade operacional com listas/tabelas/Kanban separados por bordas hairline `1px` (`--border-subtle`) em vez de caixas com sombras pesadas.
* **Drawer Co-piloto (`400px` desktop / sheet em mobile):** persistente sem perder o contexto da tela ativa.

### B. Superfície Executiva (`/exec/*`)
* Layout mais arejado (`max-w-[1040px]`), focado em PRD vivo, linha do tempo de entregas, aprovações de negócio e links de preview.
* **Barreira Rígida de Domínio:** proibido renderizar worktrees, diffs Git, logs de terminal, SARIF bruto ou custos internos de tokens.

---

## 4. Estados Obrigatórios de Toda View de Dados

Toda tela ou painel que consome dados reais/MSW deve implementar explicitamente os **5 estados de dados** + **4 micro-estados interativos**:
1. **Empty:** explicação objetiva + 1 CTA primário claro para criar o primeiro item.
2. **Sparse (1–2 itens):** alinhamento limpo sem espaços mortos artificiais nem cards gigantes esticados.
3. **Dense (20+ itens):** scroll contido (`overflow-y-auto`), cabeçalhos fixos (`sticky top-0`), truncamento seguro (`truncate`) com texto completo acessível.
4. **Loading:** *Skeleton* com a exata geometria e altura do conteúdo final (`CLS = 0`).
5. **Error:** alerta claro em `--status-danger` com ação imediata de **Tentar novamente** (sem engolir erro silenciosamente).
* **Micro-estados & Optimistic UI:** `hover`, `focus-visible` (anel `2px` em `--focus-ring`), `active`, `disabled` e feedback imediato via `useOptimistic` / `useActionState` com rollback automático em caso de falha da API.

---

## 5. Anti-Padrões Proibidos ("Anti-AI Slop")

1. **Zero gradientes roxo/azul/neon decorativos** em hero sections, cabeçalhos ou cards de métricas.
2. **Zero *card-itis*:** nunca empilhe card dentro de card com `shadow-lg`/`shadow-xl`; prefira divisões planas com borda `1px` e contraste sutil entre `--bg-canvas` e `--bg-surface`.
3. **Zero emojis decorativos** (`🚀`, `✨`, `🔥`) em títulos de página, abas, botões ou itens de menu — use ícones vetoriais uniformes com espessura compatível com a fonte (`strokeWidth={1.75}`).
4. **Zero setas genéricas (`→`)** repetidas em todo botão de ação.
5. **Zero mocks hardcoded no JSX:** todo dado simulado no desenvolvimento do frontend reside exclusivamente nos handlers **MSW** (`apps/web/src/mocks/`) validados contra `@uzina/contracts`.
6. **Zero `<div onClick>`:** ações usam `<button type="button">` e navegações usam `<Link>`/`<a>`.
