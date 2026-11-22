# Dossiê do Slice 9 — Estúdio Visual 3 Níveis & Integração Google Stitch

* **Status:** `Rascunho`
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
- [ ] Verify Gate sem cache e `audit:tests` limpos; Contract Drift verde
- [ ] Nenhum payload XSS da tabela executa no preview
- [ ] Fluxo completo: importar/obter do Stitch → tokens → aprovar → handoff
- [ ] QA visual aprovado; docs de fase; branch/PR

## 7. Revisão EGM Pré-Código (Plan Gate)
*(`egm-implementation-readiness` + `appsec-auditor` focado em XSS/SSRF/MCP.)*

## 8. Evidências Reais Pós-Código (Verify Gate)
*(Preencher ao concluir.)*
