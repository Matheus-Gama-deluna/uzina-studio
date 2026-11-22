# Especificação Técnica — Fase 2 do Uzina Studio (v1.0)

> **Status:** Planejamento aprovado (pré-código). **Fase 1 (MVP)** concluída e integrada na `main` (`a4ec6d5`).
> **Foco da Fase 2:** Inteligência de Codebase de longo prazo, Memória Híbrida (QMD) com embeddings locais PT-BR/EN e Estúdio Visual com Google Stitch — priorizando **economia de tokens** e **entendimento de código a longo prazo**.
> **Decisão registrada em:** [ADR-004](adr/004-codebase-intelligence-qmd-embeddings-stitch.md).

---

## 1. Visão e Escopo

| # | Frente | Resultado esperado | Slice |
| :-: | :--- | :--- | :-: |
| 1 | **Memória Híbrida QMD** | Busca `BM25 + vetor + RRF` sobre `memories` e Markdown do repositório, com embeddings locais bilíngues e fallback offline | 7 |
| 2 | **Codebase Intelligence** | Context Tree, esqueleto comprimido p/ Prompt Cache, grafo AST incremental, proveniência de decisões e tools cirúrgicas | 8 |
| 3 | **Estúdio Visual + Google Stitch** | Protótipos em 3 níveis, importação Stitch (MCP + HTML/Tailwind), tokens W3C, handoff `.uzina/prototypes/` | 9 |
| 4 | **Execução isolada + FinOps** | `DockerExecutionWorkspace` e painel de economia de tokens | 10 |

**Fora de escopo da Fase 2 (adiado):** Figma MCP, Penpot, DAST ativo (Nuclei/ZAP), Mutation Testing/PBT, SSO/portal externo (Fase 3).

**Regras herdadas (inegociáveis):** `AGENTS.md`, Contract-First, TDD, `pnpm verify`, zero `ee/`, Zod em toda fronteira, PGlite em processo único, AES-256-GCM para credenciais, isolamento multi-tenant, sem mocks internos em integração.

---

## 2. Fronteiras de Pacotes

```text
@uzina/contracts      (sem deps internas)  ← novos: qmd.ts, codebase.ts, prototypes.ts, finops.ts
@uzina/db             → contracts          ← novas tabelas (§3)
@uzina/core           → contracts          ← EmbeddingProvider (porta), chunker Markdown, RRF puro
@uzina/codebase-intel → contracts, core    ← NOVO: indexador AST, esqueleto, grafo, provenance
@uzina/mastra-runtime → contracts, db, core, opencode-bridge, security-engine, codebase-intel
apps/web | apps/cli   → todos os acima
```

Regras: `codebase-intel` **não** importa `db` (recebe repositório por porta/interface); persistência fica em `mastra-runtime`/`apps/web`. Modelos ONNX só são carregados em `core` via carregamento dinâmico opcional (nunca em Client Components).

---

## 3. Evolução do Schema (Drizzle `pg-core`, PGlite ↔ Postgres)

> Sempre via `drizzle-kit generate` (migrações `0006+`). Vetores: `vector(384)` no Postgres/`pgvector`; no PGlite usar extensão `vector` do PGlite quando disponível, com coluna `real[]` + similaridade em SQL como fallback testado em ambos.

| Tabela | Colunas-chave | Índices |
| :--- | :--- | :--- |
| `memory_chunks` | `id`, `organization_id`, `source_type` (`memory`\|`markdown`), `source_id`/`source_path`, `scope_type`, `scope_id`, `heading_path`, `line_start`, `line_end`, `content`, `content_hash`, `embedding vector(384) NULL`, `embedding_model`, `fts tsvector` | `(organization_id, scope_type, scope_id)`, GIN `fts`, HNSW/IVFFlat `embedding` (Postgres), UNIQUE `(source_type, source_id/path, content_hash)` |
| `codebase_files` | `id`, `repository_id`, `path`, `sha256`, `language`, `size`, `indexed_at` | UNIQUE `(repository_id, path)` |
| `codebase_symbols` | `id`, `file_id`, `kind` (`function`\|`class`\|`route`\|`zod_schema`\|`db_table`\|`component`), `name`, `signature`, `line_start`, `line_end`, `exported` | `(file_id)`, `(name)` |
| `codebase_edges` | `id`, `from_symbol_id`, `to_symbol_id`, `relation` (`imports`\|`calls`\|`validates_with`\|`queries_table`\|`renders`) | `(from_symbol_id)`, `(to_symbol_id, relation)` |
| `decision_provenance` | `id`, `organization_id`, `deliverable_id`, `decision_id NULL`, `memory_id NULL`, `symbol_id NULL`, `file_path`, `created_at` | `(organization_id, file_path)` |
| `design_prototypes` | `id`, `project_id`, `deliverable_id NULL`, `level` (1\|2\|3), `source` (`native`\|`stitch_mcp`\|`stitch_import`), `title`, `html_storage_path`, `tokens_json`, `approved`, `created_at` | `(project_id)` |
| `token_savings_events` | `id`, `organization_id`, `deliverable_id NULL`, `technique` (`prompt_cache`\|`qmd`\|`ast_graph`\|`skeleton`), `tokens_baseline`, `tokens_actual`, `created_at` | `(organization_id, created_at)` |

Todas as consultas **filtram por `organization_id`** (anti-IDOR); memórias `client` nunca vazam entre clientes (invariante já testada no Slice 5).

---

## 4. Motor QMD Híbrido e Embeddings Locais (Slice 7)

### 4.1 Pipeline
1. **Chunking por headings** (`#`, `##`, `###`) com `heading_path`, `line_start/line_end` e limite (~800 tokens; divide por parágrafo ao exceder).
2. **BM25/FTS** (`tsvector` + `ts_rank_cd`; no PGlite `to_tsvector('simple')` para termos técnicos).
3. **Vetorial** (cosseno, `top-k=20`).
4. **RRF** (k=60): $\text{RRF}(d)=\sum_{r\in\{\text{bm25},\text{vec}\}}\frac{1}{60+\text{rank}_r(d)}$.
5. **Retorno compacto:** `top-5`, ≤ 700 caracteres/trecho, com `path#Lx-Ly` e `scope`.
6. **Context Tree:** resumo de 1–2 linhas por diretório (`docs/`, `.uzina/`, `packages/*`).

### 4.2 `EmbeddingProvider` (porta em `@uzina/core`)
```ts
interface EmbeddingProvider {
  id: string;              // "e5-small-onnx" | "ollama:bge-m3" | "openai-compat:*" | "deterministic-trigram"
  dimensions: number;      // 384 padrão
  embedDocuments(texts: string[]): Promise<Float32Array[]>; // prefixo "passage: "
  embedQuery(text: string): Promise<Float32Array>;          // prefixo "query: "
}
```

| Provedor | Quando | Observação |
| :--- | :--- | :--- |
| `intfloat/multilingual-e5-small` (ONNX quantizado, 384d, ~120 MB) | **Padrão local** | Cache em `${UZINA_DATA_DIR}/models/`; download com **SHA-256 pinado** e `--offline` respeitado |
| `deterministic-trigram` (hash de trigramas, 384d) | **Fallback offline/testes** | Nunca quebra o fluxo; marca `embedding_model` para reindexar depois |
| Ollama (`bge-m3`, `nomic-embed-text`) / OpenAI-compatível | Opcional via Cofre | Chave no Cofre AES-256-GCM; dimensão ≠ 384 exige coluna/versão compatível (reindex) |

Troca de modelo ⇒ reindexação automática (`embedding_model` diferente). **BM25 sempre ativo**, mesmo sem vetor.

### 4.3 Segurança
Conteúdo indexado passa por `redactSensitiveText` **antes** de gerar chunk/embedding; indexação ignora `.env`, `.master-key`, `node_modules`, `.git`; paths validados com `path-guard`.

---

## 5. Codebase Intelligence (Slice 8)

### 5.1 Camadas
1. **Context Tree + Esqueleto** (assinaturas exportadas, schemas Zod, tabelas, rotas; sem corpos) — vai no **prefixo estável de Prompt Cache** (alvo ≤ 2.000 tokens).
2. **Grafo AST incremental** (re-indexa só arquivos cujo `sha256` mudou, guiado por `git diff`).
3. **Busca híbrida (QMD)** para docs/memórias.
4. **Provenance**: ao `merged`, liga arquivos/símbolos alterados ↔ `deliverable` ↔ `decision` ↔ `memory`.

### 5.2 Implementação
- **Nativa (zero-config):** TypeScript Compiler API (`typescript`) para TS/TSX/JS (símbolos, imports, chamadas, `z.object`, `pgTable`, rotas `app/api/**/route.ts`). Tree-Sitter via WASM fica como extensão para outras linguagens (Fase 2.x).
- **Adaptadores opcionais (degradação `skipped_missing_binary`):** `codebase-memory-mcp`, `repomix --compress`, `ast-grep`, `qmd` — executados com `shell:false`, `--`, env sanitizado (padrão do `security-engine`).

### 5.3 Tools cirúrgicas (OpenCode via MCP/skill e Co-piloto, **somente leitura**)
| Tool | Entrada | Saída (alvo de tokens) |
| :--- | :--- | :--- |
| `get_repo_context_tree` | `repositoryId` | árvore + resumos (~300) |
| `query_symbol_graph` | `symbol`, `relation`, `depth≤3` | símbolos + `path#Lx-Ly` (~300) |
| `read_symbol_slice` | `path`, `symbol` | apenas o bloco do símbolo |
| `get_file_provenance` | `path` | decisões/memórias/entregas associadas |
| `get_change_impact` | `gitRange` | símbolos e rotas afetados |

Todas validadas com Zod, escopadas por `organization_id` + repositório e limitadas por `maxResults`/`maxBytes`.

---

## 6. Estúdio Visual 3 Níveis + Google Stitch (Slice 9)

`DesignPrototypeAdapter`:
| Nível | Entrega | Motor |
| :--- | :--- | :--- |
| 1 · Estrutura | Wireframe/fluxo de telas (Mermaid/SVG a partir da Spec) | Nativo |
| 2 · Direção visual | Paleta OKLCH, tipografia, densidade → `tokens.json` (W3C DTCG) + `.uzina/DESIGN.md` | Nativo + extração do Stitch |
| 3 · Interativo | Protótipo HTML/Tailwind clicável em **preview sandboxed** | Nativo (OpenCode) ou **Google Stitch** |

**Conector Google Stitch:**
- **Modo MCP (`stitch-mcp`)**: lista projetos/telas, obtém HTML/CSS e metadados; credenciais no Cofre; executado como processo filho com `shell:false`.
- **Modo Importação**: upload/colar HTML/Tailwind exportado (funciona sem MCP).
- **Normalização**: extrai cores/tipografia/espaçamento → tokens OKLCH/W3C → atualiza `.uzina/DESIGN.md` (com aprovação humana, `approveDesignMd`).
- **Preview seguro**: `<iframe sandbox>` sem `allow-same-origin`, CSP restritiva, HTML **sanitizado** (remove `<script>`, `on*`, URLs `javascript:`), servido por rota autenticada `GET /api/prototypes/:id/preview` (nunca em `public/`).
- **Handoff**: aprovado na Caixa de Decisões → copiado para `.uzina/prototypes/<id>/` no worktree.

Figma/Penpot **fora** da Fase 2 (porta `DesignPrototypeAdapter` já os comporta depois).

---

## 7. Execução Isolada + FinOps (Slice 10)
- `DockerExecutionWorkspace` implementa `ExecutionWorkspace`: container efêmero por tarefa, `--cap-drop ALL`, `no-new-privileges`, rede desabilitada por padrão, usuário não-root, limites de CPU/memória/tempo, bind-mount apenas do worktree da tarefa, limpeza garantida (`AbortSignal`).
- **FinOps de tokens:** `token_savings_events` + painel (Cache Hit Rate, tokens economizados por técnica, Rework Rate).

---

## 8. Plano de Execução (Vertical Slices)

| Slice | Branch | Dossiê | Dependências |
| :-: | :--- | :--- | :--- |
| 7 | `feat/slice-07-qmd-hybrid-memory` | [slice-07](slices/slice-07-qmd-hybrid-memory-local-embeddings.md) | Fase 1 |
| 8 | `feat/slice-08-codebase-intel` | [slice-08](slices/slice-08-codebase-intel-ast-graph-provenance.md) | Slice 7 (reusa chunker/RRF) |
| 9 | `feat/slice-09-visual-studio-stitch` | [slice-09](slices/slice-09-visual-studio-3levels-google-stitch.md) | Slice 3 (Estúdio Lite) |
| 10 | `feat/slice-10-docker-workspace-finops` | [slice-10](slices/slice-10-docker-workspace-token-finops.md) | Slices 7–8 (telemetria) |

Cada slice segue: **Plan Gate EGM → Contract-First → TDD → Verify Gate sem cache (com `TEST_DATABASE_URL`, `0 skipped`) → QA visual (`browser`) quando houver UI → docs de fase → commit/push/PR.**

## 9. Riscos e Mitigações
| Risco | Mitigação |
| :--- | :--- |
| Modelo ONNX pesado/lento no boot | Carregamento lazy, cache em disco, fallback determinístico, `UZINA_EMBEDDINGS=off` |
| `pgvector` ausente no PGlite | Teste em ambos os dialetos; fallback `real[]` + cosseno SQL |
| Vazamento de segredo em chunks/embeddings | Redação pré-indexação + ignore list + teste dedicado |
| HTML do Stitch malicioso (XSS) | Sanitização + `iframe sandbox` + CSP + rota autenticada |
| Grafo desatualizado | Re-indexação por SHA-256 em hooks de `stage_build`/`stage_finalize` + comando `uzina index --rebuild` |
| Dependência externa (`stitch-mcp`, binários) indisponível | Degradação graciosa explícita (nunca "falso verde") |
