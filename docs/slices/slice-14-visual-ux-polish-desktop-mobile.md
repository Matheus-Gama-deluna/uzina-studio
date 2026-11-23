# Slice 14 — Polimento Visual Desktop/Mobile, Fluxo Contínuo & Eliminação de Botões Mortos

- **Status:** Concluído
- **Branch:** `feat/slice-14-visual-ux-polish-desktop-mobile`
- **Referências Visuais:** Vercel v0, Claude Artifacts (Desktop Split-Pane & Mobile Segmented Switcher), Devin e Linear.

## 1. Escopo e Problemas Resolvidos

1. **Desktop Sem Scroll para Conversar (`1440×900`):**
   - Compactação das faixas superiores e calibração do feed de mensagens (`agency-chat-history`) para que o composer (`textarea`), os chips de **Quick-Prompts** e o botão **`Enviar Mensagem`** fiquem **100% visíveis na primeira dobra (`y < 860px`)**.
2. **Mobile com Alternador Segmentado de 1 Toque (`390×844`):**
   - Barra segmentada mobile (`💬 Chat` | `🎨 Estúdio Visual` | `🗂️ Slices & Kanban`) no topo do `AgencyCommandCenter`, eliminando a rolagem vertical de `2376px` e garantindo alvos de toque confortáveis (`>= 36px–40px`).
   - Layout empilhado (`flex-col sm:flex-row`) nos campos de revisão visual/slice no mobile para evitar placeholders cortados.
   - CSS responsivo nos protótipos HTML (`buildGeneratedVisualPrototypeHtml` e `/api/prototypes/[id]/preview`) eliminando barras de rolagem horizontal dentro do `<iframe sandbox="">` em telas estreitas.
3. **Eliminação de Botões Mortos e Dessincronizações:**
   - **Sincronização Bidirecional:** Mutações no Kanban (`Avançar`, `Pausar`, `+ Nova Entrega`, `+ Novo Projeto`) invalidam `["agency-status"]` imediatamente, mantendo `Slices` e `Ciclo #N` sincronizados sem F5. Clicar no título de um card no Kanban abre o slice correspondente no inspetor.
   - **Persistência do Histórico do Chat por Projeto:** Conversas com os agentes são salvas/restauradas por projeto (`localStorage`), preservando o contexto ao navegar entre rotas ou recarregar a página.
   - **Quick-Prompts & Formatação Markdown Limpa:** Atalhos clicáveis de prompt rápido e renderização estruturada de `**negrito**`, `` `código` `` e listas nas mensagens dos agentes.
   - **Estado Pós-Aprovação do Portão Visual:** Quando o protótipo já está aprovado (`approvedForCodeHandoff === true`), exibe confirmação clara e botão direto para avançar o ciclo para `Contratos & TDD`.
   - **Árvore `HIERARQUIA (CLIENTES)` Clicável na Sidebar:** Clicar em um cliente ou projeto na barra lateral seleciona imediatamente o projeto ativo na Torre de Controle.
   - **Sub-rotas e Navegação:** Correção dos breadcrumbs de `/app/finops` e `/app/projects/[id]/code`, espaçamento dos badges em `Adaptadores & Context Tree`, feedback de estado em `/studio` para entregáveis pausados/em execução, e rotas de redirecionamento amigável em `/app/settings` (`-> /app/providers`) e `/exec` (`-> /app`).

## 2. Evidências de Verificação (DoD)

- [x] `node scripts/check-no-ee.mjs` -> `0`
- [x] `node scripts/audit-tests.mjs` -> `0 violações`
- [x] `pnpm --filter @uzina/mastra-runtime test` & `pnpm --filter @uzina/web test` -> `PASS`
- [x] `pnpm --filter @uzina/web build` & `pnpm --filter @uzina/web test:e2e` -> `2 passed`
- [x] Auditoria visual no navegador (`browser`) em Desktop (`1440×900`) e Mobile (`390×844`), Dark e Light.
