# Dossiê do Slice 9 — Estúdio Visual 3 Níveis & Integração Google Stitch

* **Status:** `Concluído`
* **Branch:** `feat/slice-09-visual-studio-stitch`
* **Estratégia Aplicada:** *Contract-First + Frontend-First (MSW) + Vertical Slice*
* **Spec de Referência:** `docs/especificacao-tecnica-fase-2-v1.0.md` (§6) · [ADR-004](../adr/004-codebase-intelligence-qmd-embeddings-stitch.md) · `.uzina/DESIGN.md`

---

## 1. Objetivo e Escopo Estrito
**Entrega:** `DesignPrototypeAdapter` com 3 níveis (Estrutura, Direção Visual, Interativo), conector **Google Stitch** (modo MCP + importação HTML/Tailwind), extração de tokens W3C (`tokens.json`) e `.uzina/DESIGN.md`, preview sandboxed e handoff para `.uzina/prototypes/`.

**Fora de escopo:** Figma/Penpot, geração de imagem (Nível 2 por imagem), edição colaborativa de canvas.

## 2. Fronteiras de Pacotes e Arquivos Previstos
- `packages/contracts/src/prototypes.ts` · `tests/slice9-contracts.test.ts`
- `packages/core/src/design/{html-sanitizer.ts,tokens-extractor.ts,tokens-w3c.ts,wireframe.ts}` (puros, browser-safe via subpath)
- `packages/mastra-runtime/src/design/{adapter.ts,native-adapter.ts,stitch-adapter.ts,stitch-mcp-client.ts}` — cliente MCP stdio (`shell:false`)
- `packages/db/src/schema/prototypes.ts` (`design_prototypes`) + migração `0008_*.sql`
- `apps/web`: `/api/projects/[id]/prototypes` (CRUD/import), `/api/projects/[id]/prototypes/stitch/{projects,screens,import}`, `GET /api/prototypes/[id]/preview`, UI no Estúdio Visual (abas Nível 1/2/3, painel Stitch), MSW + Contract Drift
- Integração com `stage_visual_studio` e Caixa de Decisões (`prototype_approve`)

## 3. Contratos Compartilhados
`PrototypeLevelSchema`, `PrototypeSourceSchema` (`native|stitch_mcp|stitch_import`), `ImportStitchHtmlSchema.strict()` (`title`, `html ≤ 2 MiB`, `viewport?`), `StitchConnectionSchema` (credencial só por referência ao Cofre), `DesignTokensW3CSchema` (DTCG: color/typography/spacing/radius), `PrototypeSchema`, `WorkflowGateType += "prototype_approve"`.

## 4. Persistência, Segurança e Decisões Técnicas
- **HTML não confiável:** sanitização determinística (remove `<script>`, `on*`, `javascript:`/`data:` perigosos, `<iframe>`, `<object>`, `<form action>` externos), limites de tamanho/profundidade; originais nunca servidos sem sanitizar.
- **Preview:** rota autenticada + `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data: https:`; `iframe sandbox=""` **sem** `allow-same-origin`; armazenado em `${UZINA_DATA_DIR}/uploads/prototypes/` (nunca `public/`).
- **Stitch MCP:** comando fixo/pinado configurável, `shell:false`, env mínimo, timeout, saída validada por Zod; token no Cofre AES-256-GCM (nunca em logs/respostas); indisponível ⇒ erro explícito + modo importação.
- Atualização do `.uzina/DESIGN.md` somente após aprovação humana.
- RBAC: leitura `READ_ROLES`; importar/aprovar `WORKSPACE_WRITE_ROLES`; credenciais `VAULT_WRITE_ROLES`.

## 5. Plano de Testes
* **Unitários (*Tests as Data*):** sanitizador (tabela de payloads XSS), extrator de tokens (HTML/Tailwind → OKLCH/DTCG), wireframe a partir de Spec.
* **Integração:** import HTML ⇒ sanitiza, persiste, preview com headers CSP corretos; adapter Stitch com **servidor MCP fake real via stdio** (processo de teste, não mock interno); aprovação ⇒ cópia em `.uzina/prototypes/` no worktree; `DESIGN.md` atualizado só após `approveDesignMd`.
* **Segurança:** XSS no preview, tamanho > limite `413`, MCP indisponível, cross-org `404`, segredo do Stitch não vaza.
* **Visual (`browser`):** Estúdio Visual Dark/Light, Desktop/Mobile, preview isolado sem erros de console.

## 6. Critérios de Pronto (DoD)
- [x] Verify Gate sem cache e `audit:tests` limpos; Contract Drift verde
- [x] Nenhum payload XSS da tabela executa no preview
- [x] Fluxo completo: importar/obter do Stitch → tokens → aprovar → handoff
- [x] QA visual aprovado; docs de fase atualizados; branch enviada

## 7. Revisão EGM Pré-Código (Plan Gate)
- **Sanitização HTML determinística (Anti-XSS):** `sanitizePrototypeHtml` remove `<script>`, `<iframe>`, `<object>`, `<embed>`, `<base>`, `<meta http-equiv>`, atributos `on*`, URLs `javascript:`/`vbscript:`/`data:text/html` e `<form action>` externos antes de persistir e antes de servir.
- **Preview Sandboxed + CSP Restritiva:** servido exclusivamente via `GET /api/prototypes/[id]/preview` autenticado (`READ_ROLES` + isolamento organizacional) com `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:;` e renderizado em `<iframe sandbox="">` sem `allow-scripts` nem `allow-same-origin`.
- **Armazenamento isolado:** HTML sanitizado salvo em `${UZINA_DATA_DIR}/uploads/prototypes/<id>.html` (nunca em `apps/web/public/`).
- **Stitch MCP (`shell: false`):** cliente JSON-RPC stdio com `execFile`, env mínimo, timeout estrito (`8000ms`), saída validada com Zod e degradação explícita para modo de importação HTML/Tailwind quando indisponível.
- **Handoff & `DESIGN.md`:** cópia para `.uzina/prototypes/<id>/{index.html,tokens.json}` e atualização de `.uzina/DESIGN.md` somente mediante aprovação humana (`WORKSPACE_WRITE_ROLES`).

## 8. Evidências Reais Pós-Código (Verify Gate)
* **`node scripts/check-no-ee.mjs`:** exit `0`.
* **`pnpm turbo run build --force`:** `Tasks: 9 successful, 9 total` (`0 cached`).
* **`node scripts/audit-tests.mjs`:** `Arquivos: 58 | Testes: 183 | Suprimidos: 2 | Violações: 0`.
* **`pnpm turbo run typecheck lint test --force` (com `TEST_DATABASE_URL=postgresql://uzina:uzina@127.0.0.1:5432/uzina_dev` em `pgvector/pgvector:pg16`):** `Tasks: 34 successful, 34 total` (`0 cached`), **`464 passed | 0 skipped`**:
  * `@uzina/contracts`: `9 passed (9)`, `146 passed (146)`
  * `@uzina/core`: `13 passed (13)`, `149 passed (149)`
  * `@uzina/security-engine`: `3 passed (3)`, `19 passed (19)`
  * `@uzina/codebase-intel`: `1 passed (1)`, `8 passed (8)`
  * `@uzina/cli`: `1 passed (1)`, `13 passed (13)`
  * `@uzina/opencode-bridge`: `3 passed (3)`, `45 passed (45)`
  * `@uzina/db`: `11 passed (11)`, `38 passed (38)` (incluindo `postgres-live.test.ts` sem skips)
  * `@uzina/mastra-runtime`: `7 passed (7)`, `19 passed (19)` (incluindo servidor MCP stdio fake real via `execFile`)
  * `@uzina/web`: `10 passed (10)`, `27 passed (27)` (incluindo `slice9-api.test.ts` e `contract-drift.test.ts`)
* **`pnpm --filter @uzina/web test:e2e` (Playwright):** `2 passed (11.9s)`.
* **QA Visual (`browser`, `Model: "flash"` em `http://localhost:3049/app/projects/[id]/studio`):** **PASS** — importação `"Checkout Google Stitch"` com `<script>` neutralizado, extração W3C DTCG (`oklch(0.75 0.14 210)`), `<iframe sandbox="">`, aprovação com handoff e atualização de `DESIGN.md`, degradação graciosa de `stitch-mcp` (`unavailable`), `0` erros de console, `0` HTTP `>= 500`, `0` overflow horizontal em Desktop Dark/Light (`1440×900`) e Mobile (`390×844`).
