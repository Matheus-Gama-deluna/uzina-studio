# Dossiê do Slice 8 — Codebase Intelligence: Grafo AST, Esqueleto & Proveniência

* **Status:** `Concluído`
* **Branch:** `feat/slice-08-codebase-intel`
* **Estratégia Aplicada:** *Domain-First + Contract-First + Vertical Slice*
* **Spec de Referência:** `docs/especificacao-tecnica-fase-2-v1.0.md` (§3, §5) · [ADR-004](../adr/004-codebase-intelligence-qmd-embeddings-stitch.md)

---

## 1. Objetivo e Escopo Estrito
**Entrega:** pacote `@uzina/codebase-intel` com Context Tree, esqueleto comprimido (Prompt Cache), grafo AST incremental (TS/TSX/JS), proveniência de decisões e 5 tools **somente leitura** para OpenCode/Co-piloto; adaptadores opcionais (`repomix`, `ast-grep`, `codebase-memory-mcp`, `qmd`).

**Fora de escopo:** outras linguagens (Tree-Sitter WASM = extensão posterior), refatoração automática, embeddings de código.

## 2. Fronteiras de Pacotes e Arquivos Previstos
- `packages/codebase-intel/` (`package.json`, `tsconfig`, `vitest.config`) — importa **apenas** `@uzina/contracts` e `@uzina/core`; **sem** `db`.
- `src/{scanner.ts,ts-indexer.ts,skeleton.ts,context-tree.ts,graph.ts,provenance.ts,tools.ts,adapters/*.ts}`
- `packages/contracts/src/codebase.ts` · `tests/slice8-contracts.test.ts`
- `packages/db/src/schema/codebase.ts` (`codebase_files`, `codebase_symbols`, `codebase_edges`, `decision_provenance`) + migração `0007_*.sql`
- `packages/mastra-runtime/src/codebase/{repository.ts,sync.ts}`; hooks em `stage_build` (re-index por `git diff`) e `stage_finalize` (grava provenance)
- Registro das tools no Co-piloto e injeção do esqueleto no prefixo de prompt do OpenCode
- `apps/web`: `/api/codebase/{tree,symbols,provenance,reindex}`, tela "Mapa do Código" em `/app/projects/[id]/code`
- `apps/cli`: `uzina index code [--rebuild]`, `uzina code skeleton`

## 3. Contratos Compartilhados
`CodebaseSymbolKindSchema`, `CodebaseRelationSchema`, `SymbolGraphQuerySchema.strict()` (`symbol`, `relation`, `depth ≤ 3`, `maxResults ≤ 50`), `SymbolSliceRequestSchema`, `ProvenanceQuerySchema`, `ChangeImpactRequestSchema`, DTOs de resposta com `path#Lx-Ly`, `SkeletonResponseSchema` (`tokensEstimated`).

## 4. Persistência, Segurança e Decisões Técnicas
- Reindex incremental: compara `sha256` por arquivo; remove símbolos/arestas de arquivos apagados.
- **Segurança de leitura:** `read_symbol_slice` usa `path-guard` (sem traversal, sem symlink para fora do repo/worktree), nega `.env`/`.master-key`, redige segredos e limita `maxBytes`.
- Tools escopadas por `organization_id` + `repository_id`; Co-piloto continua **sem escrita**.
- Adaptadores externos: `execFile`, `shell:false`, `--`, env sanitizado, timeout; ausência ⇒ `skipped_missing_binary` explícito.
- Orçamento do esqueleto configurável (`UZINA_SKELETON_MAX_TOKENS`, padrão 2000), ordenado por centralidade (grau no grafo).

## 5. Plano de Testes
* **Unitários (*Tests as Data*):** extração de símbolos (função, classe, `z.object`, `pgTable`, rota `route.ts`, componente React), arestas `imports/calls/validates_with/queries_table`, esqueleto sem corpos, estabilidade por hash.
* **Integração (repo temporário real + PGlite/Postgres):** indexar fixture, alterar 1 arquivo ⇒ só ele é reindexado, deletar arquivo ⇒ limpeza, `query_symbol_graph` (chamadores/dependentes), `get_change_impact` sobre `git diff` real, provenance gravada em `merged`.
* **Segurança/Fronteira:** traversal/symlink, `.env` bloqueado, cross-org, limites `maxResults/maxBytes`, tools do Co-piloto não escrevem.
* **Métrica:** teste que compara tokens (baseline = leitura de arquivos vs. tool) e grava `token_savings_events`.

## 6. Critérios de Pronto (DoD)
- [x] Verify Gate sem cache (`0 skipped` Postgres) e `audit:tests` sem violações
- [x] Reindex incremental comprovado (arquivos tocados = arquivos reindexados)
- [x] Redução medida ≥ 80% de tokens em consultas estruturais da fixture
- [x] Adaptadores com degradação explícita testada
- [x] QA visual do "Mapa do Código"; docs de fase atualizados; branch enviada

## 7. Revisão EGM Pré-Código (Plan Gate)
- **Fronteira estrita de pacote:** `@uzina/codebase-intel` importa apenas `@uzina/contracts`, `@uzina/core`, `typescript` e `zod` (zero `@uzina/db`).
- **Indexação AST incremental sem execução:** usa TypeScript Compiler API (`ts.createSourceFile`) e `sha256` por arquivo; nunca executa código alvo.
- **Contenção de leitura em `readSymbolSlice`:** valida paths com `assertPathInsideWorkspace`, bloqueia `.env*`/`.master-key` e aplica `redactSensitiveText` antes de retornar o trecho.
- **Orçamento determinístico de Prompt Cache:** esqueleto limitado por `UZINA_SKELETON_MAX_TOKENS` (padrão `2000`) ordenado por grau de centralidade no grafo AST e prioridade de símbolos exportados.

## 8. Evidências Reais Pós-Código (Verify Gate)
* **`node scripts/check-no-ee.mjs`:** exit `0`.
* **`pnpm turbo run build --force`:** `Tasks: 9 successful, 9 total` (`0 cached`).
* **`node scripts/audit-tests.mjs`:** `Arquivos: 53 | Testes: 173 | Suprimidos: 2 | Violações: 0`.
* **`pnpm turbo run typecheck lint test --force` (com `TEST_DATABASE_URL=postgresql://uzina:uzina@127.0.0.1:5432/uzina_dev` em `pgvector/pgvector:pg16`):** `Tasks: 34 successful, 34 total` (`0 cached`), **`444 passed | 0 skipped`**:
  * `@uzina/contracts`: `8 passed (8)`, `138 passed (138)`
  * `@uzina/core`: `12 passed (12)`, `141 passed (141)`
  * `@uzina/codebase-intel`: `1 passed (1)`, `8 passed (8)`
  * `@uzina/security-engine`: `3 passed (3)`, `19 passed (19)`
  * `@uzina/cli`: `1 passed (1)`, `13 passed (13)`
  * `@uzina/opencode-bridge`: `3 passed (3)`, `45 passed (45)`
  * `@uzina/db`: `10 passed (10)`, `37 passed (37)` (incluindo `postgres-live.test.ts` sem skips)
  * `@uzina/mastra-runtime`: `6 passed (6)`, `17 passed (17)`
  * `@uzina/web`: `9 passed (9)`, `26 passed (26)` (revalidado após ajuste de layout Mobile)
* **`pnpm --filter @uzina/web test:e2e` (Playwright):** `2 passed (11.7s)`.
* **QA Visual (`browser`, `Model: "flash"` em `http://localhost:3048/app/projects/[id]/code`):** **PASS** após correção de overflow horizontal em Mobile (`min-w-0` + `overflow-auto`); indexação AST de `219` arquivos / `618` símbolos / `1716` arestas (`99.5%` economia no esqueleto Prompt Cache), busca `"build"` (`20` cards) e leitura de fatia (`92.4%` economia), `0` erros de console, `0` HTTP `>= 500`, `0` overflow horizontal em Desktop Dark/Light (`1440×900`) e Mobile (`390×844`).
