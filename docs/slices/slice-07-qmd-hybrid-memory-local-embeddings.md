# Dossiê do Slice 7 — Motor QMD Híbrido & Memória Vetorial com Embeddings Locais

* **Status:** `Rascunho`
* **Branch:** `feat/slice-07-qmd-hybrid-memory`
* **Estratégia Aplicada:** *Contract-First + Domain-First (Tests as Data) + Vertical Slice*
* **Spec de Referência:** `docs/especificacao-tecnica-fase-2-v1.0.md` (§3, §4) · [ADR-004](../adr/004-codebase-intelligence-qmd-embeddings-stitch.md)

---

## 1. Objetivo e Escopo Estrito
**Entrega:** busca híbrida `BM25 + vetor + RRF` sobre (a) tabela `memories` (`org | client | project`) e (b) arquivos Markdown do repositório (`.uzina/`, `docs/`), com embeddings locais bilíngues PT-BR/EN, fallback offline e UI de busca em `/app/memories`.

**Fora de escopo:** grafo AST/código (Slice 8), Stitch (Slice 9), Docker workspace (Slice 10), embeddings de código-fonte.

## 2. Fronteiras de Pacotes e Arquivos Previstos
- `packages/contracts/src/qmd.ts` (+ export em `index.ts`) · `tests/slice7-contracts.test.ts`
- `packages/core/src/qmd/{chunker.ts,rrf.ts,embedding-provider.ts,deterministic-embedding.ts,context-tree.ts}` + subpath browser-safe `@uzina/core/qmd` · `tests/qmd-*.test.ts`
- `packages/core/src/qmd/onnx-e5-provider.ts` (carregamento dinâmico opcional; **não** importado por Client Components)
- `packages/db/src/schema/memory-chunks.ts` + migração `0006_*.sql` · `tests/slice7-memory-chunks.test.ts`
- `packages/mastra-runtime/src/qmd/{indexer.ts,search.ts}` (indexação incremental por `content_hash`, hooks em `createMemoryScoped/updateMemoryScoped/deleteMemoryScoped`)
- `apps/web/src/app/api/memories/search/route.ts`, `apps/web/src/app/api/qmd/reindex/route.ts`, MSW + Contract Drift, UI de busca em `memories-manager.tsx`
- `apps/cli`: `uzina index docs` e `uzina memory search "<consulta>"`

## 3. Contratos Compartilhados (`@uzina/contracts`)
`QmdSourceTypeSchema`, `QmdSearchRequestSchema.strict()` (`query` 2–500, `scope?`, `projectId?`, `clientId?`, `limit` 1–10 padrão 5, `mode` `hybrid|lexical|vector`), `QmdSearchHitSchema` (`id`, `sourceType`, `path?`, `memoryId?`, `headingPath`, `lineStart`, `lineEnd`, `snippet ≤ 700`, `scores {bm25, vector, rrf}`), `QmdSearchResponseSchema`, `QmdReindexRequestSchema`, `QmdStatusSchema` (`embeddingModel`, `indexedChunks`, `degraded: boolean`).

## 4. Persistência, Segurança e Decisões Técnicas
- Tabela `memory_chunks` (spec §3); `vector(384)` no Postgres; PGlite com extensão `vector` ou fallback `real[]` + cosseno SQL (**testar ambos**).
- Redação (`redactSensitiveText`) **antes** de chunk/embedding; ignorar `.env`, `.master-key`, `node_modules`, `.git`; `path-guard` para paths.
- RBAC: busca = `READ_ROLES`; reindex = `VAULT_WRITE_ROLES`; filtro obrigatório por `organization_id`; memórias `client` isoladas.
- Env: `UZINA_EMBEDDINGS` (`auto|e5|deterministic|off`), `UZINA_MODELS_DIR` (padrão `${UZINA_DATA_DIR}/models`). Download do modelo com **SHA-256 pinado**; respeita modo offline.
- Troca de `embedding_model` ⇒ reindexação.

## 5. Plano de Testes (*Spec → Teste* antes do Build)
* **Unitários (*Tests as Data*):** chunker (headings aninhados, código fenced, limites, linhas exatas), RRF (empates, listas disjuntas, determinismo), embedding determinístico (estabilidade, dimensão 384, normalização), context tree.
* **Integração (PGlite real; Postgres live com `TEST_DATABASE_URL`):** indexar memórias + Markdown, busca `lexical|vector|hybrid`, termo técnico exato (`VAULT_WRITE_ROLES`) achado via BM25, consulta em português achando conteúdo em inglês via vetor, reindex idempotente.
* **Segurança/Fronteira:** isolamento Cliente A × B, cross-org `404/vazio`, segredo `sk-...` nunca aparece em chunk/snippet, `query` inválida `400`, RBAC `403`, path traversal rejeitado.
* **Contrato/UI:** MSW + Contract Drift; teste real do provider ONNX marcado `skipIf` sem modelo em cache (CI sem rede usa determinístico).

## 6. Critérios de Pronto (DoD)
- [ ] `check-no-ee`, `audit:tests`, `build --force`, `typecheck lint test --force` (com `TEST_DATABASE_URL`, `0 skipped` no Postgres)
- [ ] Busca híbrida com `scores` explicáveis e snippets ≤ 700 chars
- [ ] Fallback offline comprovado (`UZINA_EMBEDDINGS=deterministic`)
- [ ] Isolamento multi-tenant e redação de segredos comprovados por teste
- [ ] QA visual (`browser`) da busca em `/app/memories` (Dark/Light, Desktop/Mobile)
- [ ] Docs de fase atualizados; branch enviada; PR aberta

## 7. Revisão EGM Pré-Código (Plan Gate)
*(Executar `egm-implementation-readiness` + `egm-design` antes de codificar.)*

## 8. Evidências Reais Pós-Código (Verify Gate)
*(Preencher ao concluir.)*
