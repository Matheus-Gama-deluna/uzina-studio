# Checklist: Tokens W3C, WCAG 2.1 AA e 5 Estados de Interface

## 1. Tokens Semânticos e Contraste (WCAG 2.1 AA)
- [ ] Nenhum valor hex/rgb hardcoded fora da camada de tokens (`--color-*`, `--surface-*`, `--text-*`).
- [ ] Texto normal ($\lt 18\text{pt}$ / $14\text{pt}$ bold): contraste mínimo **4.5:1**.
- [ ] Texto grande, ícones funcionais e bordas de foco/inputs: contraste mínimo **3.0:1**.
- [ ] Indicadores de status nunca dependem apenas de cor (acompanham texto, ícone ou padrão).
- [ ] Valores numéricos financeiros, contagens e timestamps usam `font-variant-numeric: tabular-nums`.

## 2. Os 5 Estados Obrigatórios em Toda Tela de Dados
1. **`loading`:** skeleton estrutural preservando dimensões próximas do conteúdo final (evita CLS).
2. **`empty`:** explicação clara do motivo do vazio + ação primária objetiva para sair dele.
3. **`error`:** erro amigável em Português do Brasil sem stack trace interno + botão explícito de tentativa/recuperação.
4. **`partial`:** indicação transparente quando parte dos dados falhou ou está sendo processada em segundo plano.
5. **`populated`:** densidade equilibrada respeitando ritmo `4px`/`8px` e limites de largura legíveis.

## 3. Responsividade Mobile (`390x844`) & Desktop (`1440x900`)
- [ ] Zero overflow horizontal (`scrollWidth <= clientWidth`) em `390px` e `1440px`.
- [ ] Área clicável (*touch target*) mínima de `44x44px` para botões e links primários em mobile.
- [ ] Foco por teclado (`:focus-visible`) visível e ordem lógica de tabulação preservada.

## 4. Reutilização `packages/ui`
- [ ] Toda seção do protótipo aponta no `PrototypeComponentManifest` qual primitiva de `packages/ui` (`data-slot`) será utilizada pelo Builder.
