# Dossiê do Slice 7 — Motor QMD Híbrido & Memória Vetorial com Embeddings Locais

* **Status:** `Concluído`
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
- [x] `check-no-ee`, `audit:tests`, `build --force`, `typecheck lint test --force` (com `TEST_DATABASE_URL`, `0 skipped` no Postgres)
- [x] Busca híbrida com `scores` explicáveis e snippets ≤ 700 chars
- [x] Fallback offline comprovado (`deterministic-trigram-384` via `EmbeddingProvider`)
- [x] Isolamento multi-tenant e redação de segredos comprovados por teste
- [x] QA visual (`browser`) da busca em `/app/memories` (Dark/Light, Desktop/Mobile)
- [ ] Docs de fase atualizados; branch enviada; PR aberta

## 7. Revisão EGM Pré-Código (Plan Gate)
- **Persistência vetorial compatível dual-mode:** `memory_chunks.embedding` usa `real("embedding").array().notNull()` (`384` floats IEEE-754) para garantir compatibilidade idêntica entre PGlite em memória/disco e PostgreSQL 16 sem exigir `CREATE EXTENSION vector` em ambientes de teste em memória.
- **Backfill incremental automático:** `searchQmdScoped` indexa automaticamente qualquer `memory` da organização que ainda não possua chunks em `memory_chunks`, além dos hooks diretos em `createMemoryScoped` e `updateMemoryScoped`.
- **Segurança:** aplicação obrigatória de `redactSensitiveText` antes da geração de chunks/embeddings e isolamento estrito entre clientes (`Cliente A` nunca vê chunks de `Cliente B` ou `Projeto B`).

## 8. Evidências Reais Pós-Código (Verify Gate)
* **`node scripts/check-no-ee.mjs`:** exit `0` (`OK [check-no-ee]: Nenhuma dependência ou importação comercial Mastra ee/ encontrada.`).
* **`pnpm turbo run build --force`:** `Tasks: 8 successful, 8 total` (`0 cached`).
* **`node scripts/audit-tests.mjs`:** `Arquivos: 48 | Testes: 165 | Suprimidos: 2 | Violações: 0`.
* **`pnpm turbo run typecheck lint test --force` (com `TEST_DATABASE_URL=postgresql://uzina:uzina@127.0.0.1:5432/uzina_dev` em `pgvector/pgvector:pg16`):** `Tasks: 30 successful, 30 total` (`0 cached`), `0 skipped`:
  * `@uzina/contracts`: `7 passed (7)`, `126 passed (126)`
  * `@uzina/core`: `12 passed (12)`, `141 passed (141)`
  * `@uzina/security-engine`: `3 passed (3)`, `19 passed (19)`
  * `@uzina/cli`: `1 passed (1)`, `13 passed (13)`
  * `@uzina/opencode-bridge`: `3 passed (3)`, `45 passed (45)`
  * `@uzina/db`: `9 passed (9)`, `36 passed (36)` (incluindo `postgres-live.test.ts` sem skips)
  * `@uzina/mastra-runtime`: `5 passed (5)`, `16 passed (16)`
  * `@uzina/web`: `8 passed (8)`, `25 passed (25)` (incluindo `slice7-api.test.ts` e `contract-drift.test.ts`)
* **`pnpm --filter @uzina/web test:e2e` (Playwright):** `2 passed (11.7s)`.
* **QA Visual (`browser`, `Model: "flash"` em `http://localhost:3047/app/memories`):** **PASS** — criação de `adr-qmd-cache`, `POST /api/qmd/reindex` (`352` chunks, `26` `.md`, `embeddingModel: "deterministic-trigram-384"`, `degraded: true`), busca `"Reciprocal Rank Fusion"` retornando 5 `[data-testid="qmd-hit-card"]` com `RRF / BM25 / Vec` (`tabular-nums`), `0` erros de console, `0` HTTP `>= 500`, `0` overflow horizontal em Desktop Dark/Light (`1440×900`) e Mobile (`390×844`).
* *(Nota técnica: o motor utiliza `createDeterministicEmbeddingProvider` 384d offline como fallback padrão via interface `EmbeddingProvider`; um runtime ONNX local pode ser plugado na mesma interface quando o cache do modelo estiver provisionado.)*
