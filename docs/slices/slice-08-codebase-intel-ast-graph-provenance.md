# Dossiê do Slice 8 — Codebase Intelligence: Grafo AST, Esqueleto & Proveniência

* **Status:** `Rascunho`
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
- [ ] Verify Gate sem cache (`0 skipped` Postgres) e `audit:tests` sem violações
- [ ] Reindex incremental comprovado (arquivos tocados = arquivos reindexados)
- [ ] Redução medida ≥ 80% de tokens em consultas estruturais da fixture
- [ ] Adaptadores com degradação explícita testada
- [ ] QA visual do "Mapa do Código"; docs de fase; branch/PR

## 7. Revisão EGM Pré-Código (Plan Gate)
*(Obrigatório `egm-implementation-readiness` + `egm-design`; slice de arquitetura crítica.)*

## 8. Evidências Reais Pós-Código (Verify Gate)
*(Preencher ao concluir.)*
