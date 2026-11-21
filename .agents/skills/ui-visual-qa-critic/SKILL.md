---
name: ui-visual-qa-critic
description: >-
  Protocolo de critica e verificacao visual deterministica para telas do Uzina Studio usando o subagente
  browser e Playwright. Use apos implementar ou alterar qualquer tela, layout ou componente web.
---

# Skill: UI Visual QA Critic (4 Passes + Playwright Determinístico)

Inspirada nos comandos `/audit`, `/critique`, `/polish` e `/distill` do **`pbakaus/impeccable`** combinados com QA determinístico em browser.

---

## 1. Protocolo de Crítica em 4 Passes

Antes de aprovar qualquer tela construída em `apps/web`:

1. **Pass 1 — AUDIT (Técnico & Acessibilidade):**
   - Zero erros no console do navegador e zero requisições HTTP `>= 400` inesperadas.
   - Contraste WCAG >= 4.5:1 (texto) e >= 3:1 (bordas/ícones interativos) tanto em **Dark** quanto em **Light**.
   - Navegação por teclado (`Tab`, `Enter`, `Esc`, foco visível) e `aria-label` em botões sem texto.
2. **Pass 2 — CRITIQUE (Hierarquia & Anti-Slop):**
   - A ação principal da tela é óbvia em < 2 segundos?
   - Existe *card-itis* (caixas aninhadas desnecessárias) ou ruído decorativo (gradientes/emojis clichê)?
   - Os valores numéricos estão alinhados com `tabular-nums` e sem truncamento quebrado?
3. **Pass 3 — POLISH (Estados & Micro-detalhes):**
   - Verifique os 5 estados obrigatórios (*Empty, Sparse, Dense, Loading Skeleton, Error*).
   - Valide alinhamento de bordas hairline `1px`, espaçamento consistente e feedback `hover`/`focus-visible`/`disabled`.
4. **Pass 4 — DISTILL (Subtração):**
   - Remova rótulos redundantes, badges duplicados ou decorações que não ajudam o operador a decidir mais rápido.

---

## 2. Matriz Obrigatória de Inspeção no `browser` (`Model: "flash"`)

Ao validar qualquer rota de UI no subagente `browser`:
1. **Desktop (`1280×800`) — Dark Mode (padrão):** layout, densidade, alinhamento, console limpo e rede `2xx`.
2. **Light Mode (`emulateMedia` / toggle de tema):** confirmar que nenhuma cor hardcoded quebrou contraste ou deixou texto invisível.
3. **Tablet (`768×1024`) & Mobile (`390×844`):** confirmar ausência de overflow horizontal (`scrollWidth <= clientWidth`), botões clicáveis sem corte e adaptação limpa de Sidebar/Drawers.
4. **Screenshot de Evidência:** capturar e inspecionar a screenshot real antes de declarar a tela aprovada.

---

## 3. Regras para Testes Visuais em Playwright (`apps/web/e2e/`)

1. **Zero `waitForTimeout`:** aguarde `data-testid`, estado visível ou resposta de rede/MSW determinística.
2. **Zero Flakiness de Animação:** injete CSS global de teste desligando animações e transições (`animation-duration: 0s !important; transition-duration: 0s !important`) antes de snapshots visuais.
3. **Dados Determinísticos:** congele datas/timestamps exibidos na UI durante capturas comparativas e mantenha o ambiente de CI em container Linux oficial do Playwright para evitar variações de anti-aliasing de fontes.
