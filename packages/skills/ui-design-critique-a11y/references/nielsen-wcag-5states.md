# Referência: Auditoria Nielsen, WCAG 2.1 AA & 5 Estados

## 1. Critérios Bloqueantes (Qualquer falha → `changes_required`)
1. **Contraste WCAG 2.1 AA:** texto normal `< 4.5:1` ou controles/ícones `< 3.0:1`.
2. **Estado Faltante:** ausência de qualquer um dos 5 estados (`loading`, `empty`, `error`, `partial`, `populated`) em superfícies orientadas a dados.
3. **Quebra Mobile (`390x844`):** `scrollWidth > clientWidth` ou elemento interativo principal `< 44x44px`.
4. **Acessibilidade de Teclado e Leitores de Tela:** botões sem texto acessível, imagens funcionais sem `alt`, modais sem foco gerenciado ou ausência de `:focus-visible`.
5. **Vazamento de RBAC / Segredos:** exposição de ações proibidas ao papel atual ou exibição de segredos/stack traces na UI.
6. **Drift de Design System:** cores hex hardcoded fora dos tokens de `.uzina/DESIGN.md` ou reimplementação de primitivas existentes em `packages/ui`.

## 2. Heurísticas de Nielsen Aplicadas ao Cockpit
- **Status do Sistema:** progresso de build/verificação/varredura visível com feedback de duração e estado.
- **Prevenção de Erros:** confirmação explícita com consequência clara para ações irreversíveis (merge, revogação de chave, deleção).
- **Reconhecimento em vez de Memorização:** rótulos claros em Português do Brasil, valores monetários e métricas alinhados com `tabular-nums`.
- **Recuperação de Erros:** toda falha exibe causa compreensível e caminho de retry ou ação corretiva.
