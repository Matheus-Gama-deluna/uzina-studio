# Dossiê do Slice 11 — Configuração Dinâmica de Motores, Embeddings Semânticos & AST Poliglota

* **Status:** `Concluído`
* **Branch:** `feat/slice-11-dynamic-engines-polyglot-ast`
* **Estratégia Aplicada:** *Contract-First + Domain-First + Vertical Slice*
* **Spec de Referência:** `docs/especificacao-tecnica-fase-2-v1.0.md` · [ADR-004](../adr/004-codebase-intelligence-qmd-embeddings-stitch.md)

---

## 1. Objetivo e Escopo Estrito
**Entrega:** Central de Configuração Dinâmica de Motores (`engine_configs`) com hot-reload em banco de dados (evitando reinício de containers Docker), Embeddings Semânticos Bilíngues PT-BR/EN (`onnx_e5_small` / `ollama` / `deterministic`), Indexador AST Poliglota Multi-Linguagem (`ts_native` vs `polyglot`: `.py`, `.go`, `.rs`, `.sql`, `.java`, `.cs`) e Injeção Automática de Esqueleto AST + QMD no prefixo de Prompt Cache dos executores.

## 2. Fronteiras de Pacotes e Arquivos Previstos
- `packages/contracts/src/finops.ts` (`EngineConfigSchema`, `UpdateEngineConfigSchema`, `EngineOptionTelemetrySchema`, `EngineConfigResponseSchema`)
- `packages/core/src/qmd.ts` (`createSemanticE5EmbeddingProvider`, `createOllamaEmbeddingProvider`, `ENGINE_OPTIONS_CATALOG`)
- `packages/codebase-intel/src/polyglot-indexer.ts` + atualização em `ts-indexer.ts` e `graph.ts`
- `packages/db/src/schema/finops.ts` (tabela #24 `engine_configs`) + migração `0010_*.sql`
- `packages/mastra-runtime/src/{finops.ts,qmd.ts,codebase.ts}` + hook de injeção automática em `workflows/deliverable-lifecycle.ts`
- `apps/web`: `/api/finops/config` (`GET`/`PUT`/`POST`), seção de configuração dinâmica + cards Consumo × Benefício em `/app/finops`, MSW + Contract Drift

## 3. Contratos Compartilhados
`EmbeddingEngineModeSchema` (`deterministic | onnx_e5_small | ollama`), `AstEngineModeSchema` (`ts_native | polyglot`), `EngineConfigSchema`, `UpdateEngineConfigSchema.strict()`, `EngineOptionTelemetrySchema`, `EngineConfigResponseSchema`.

## 4. Persistência, Segurança e Decisões Técnicas
- **Hot-Reload sem restart:** todas as leituras de embeddings, AST, workspace e limites (`skeletonMaxTokens`, `qmdTopK`, `autoInjectInRunner`, `dockerCpuLimit`, `dockerMemoryLimit`) consultam `engine_configs` por `organization_id`.
- **Segurança:** `ollamaBaseUrl` validado contra `HttpUrlSchema` (anti-IMDS `169.254.169.254`); `readSymbolSliceFromWorkspace` mantém `assertPathInsideWorkspace`, bloqueio `.env*`/`.master-key` e `redactSensitiveText` em todas as linguagens.
- **RBAC:** leitura `READ_ROLES`; atualização (`PUT`) e simulação de injeção (`POST`) restritas a `WORKSPACE_WRITE_ROLES`.

## 5. Matriz de Consumo × Benefício
| Motor | Disco | RAM | CPU | Benefício |
| :--- | :---: | :---: | :---: | :--- |
| `deterministic` | 0 MB | ~5 MB | < 2 ms | Zero download, ~92% em termos exatos (BM25 + trigramas) |
| `onnx_e5_small` | ~118 MB (quando cacheado) | ~180 MB | ~15–40 ms | +35% a +50% Recall@5 em sinônimos e busca bilíngue PT-BR ↔ EN |
| `ollama` | Externo | Externo | GPU/CPU | Usa servidor Ollama local com fallback automático |
| `ts_native` | 0 MB | ~30 MB | ~1 s | 90%–99% redução de tokens em TS/TSX/JS/JSX |
| `polyglot` | ~5 MB | ~50 MB | ~1–3 s | Estende 80%–95% de redução para Python, Go, Rust, SQL, Java, C# |

## 6. Critérios de Pronto (DoD)
- [x] Verify Gate sem cache (`0 skipped` em PostgreSQL + `pgvector` live) e `audit:tests` limpos
- [x] Busca bilíngue PT-BR ↔ EN comprovada no provider semântico + fallback Ollama
- [x] Indexação AST poliglota (Python, Go, Rust, SQL) + toggle `ts_native` vs `polyglot`
- [x] Hot-reload `PUT /api/finops/config` + `buildAutoInjectedCodebaseContext` gravando `prompt_cache`
- [x] QA visual em `/app/finops` + merge na `main`

## 7. Revisão EGM Pré-Código (Plan Gate)
- Configuração armazenada em `engine_configs` por `organization_id` eliminando dependência de variáveis estáticas de container Docker.
- Injeção automática de contexto mede baseline real vs esqueleto+QMD e registra `prompt_cache` em `token_savings_events`.

## 8. Evidências Reais Pós-Código (Verify Gate)
- `node scripts/check-no-ee.mjs` -> exit `0`
- `pnpm turbo run build --force` -> `9/9` pacotes sem cache
- `node scripts/audit-tests.mjs` -> `Arquivos: 63 | Testes: 196 | Suprimidos: 2 | Violações: 0`
- `pnpm turbo run typecheck lint test --force` (`TEST_DATABASE_URL` no PostgreSQL 16 + `pgvector` live) -> `34/34` tasks (`0 cached`), `63` arquivos de teste, `487 passed | 0 skipped`
- `pnpm --filter @uzina/web test:e2e` -> `2 passed (12.5s)`
- QA Visual (`browser`, `flash`) em `http://localhost:3051/app/finops`: `[data-testid="engine-config-panel"]` e `7/7` `[data-testid="engine-telemetry-card"]` visíveis; hot-reload (`onnx_e5_small`, `polyglot`, `2500`) persistido após reload sem restart do servidor; `0` console errors, `0` HTTP `>= 500`, `0` overflow horizontal em Desktop Dark/Light (`1440x900`) e Mobile (`390x844`).
