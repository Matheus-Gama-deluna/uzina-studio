# ADR-004: Inteligência de Codebase, Memória Híbrida (QMD), Embeddings Locais e Google Stitch

* **Status:** Aceita
* **Data:** 2026-11-22
* **Contexto de Origem:** Fase 2 / Slices 7–10

## Contexto
Sem camada estrutural, agentes exploram código via `grep` + leitura de arquivos inteiros (25–50 mil tokens por tarefa) e perdem o "porquê" das decisões ao longo do tempo. As memórias/documentos estão em **português**, enquanto símbolos e termos técnicos estão em **inglês/código**; busca puramente vetorial falha em identificadores exatos e busca puramente lexical falha em semântica. O Estúdio Visual precisa de prototipação sem lock-in de Figma nesta fase.

## Decisão
1. **Separar Memória/Markdown de Código-Fonte:**
   - Markdown e `memories` → **pipeline QMD**: chunking por headings + **BM25 + vetor + RRF (k=60)** + Context Tree, retorno `top-5` compacto com `path#Lx-Ly`.
   - Código → **`@uzina/codebase-intel`**: Context Tree + esqueleto de assinaturas (prefixo de Prompt Cache) + **grafo AST incremental (SHA-256)** + **proveniência** (símbolo ↔ entrega ↔ decisão ↔ memória) + tools cirúrgicas somente leitura.
2. **Embeddings locais por porta `EmbeddingProvider`:** padrão `intfloat/multilingual-e5-small` (ONNX, 384d, prefixos `query:`/`passage:`), fallback `deterministic-trigram` (offline/testes), opcionais Ollama (`bge-m3`/`nomic-embed-text`) e OpenAI-compatível via Cofre. **BM25 nunca é desligado.**
3. **Implementação nativa primeiro (zero-config)** com TypeScript Compiler API; **adaptadores opcionais** (`codebase-memory-mcp`, `repomix --compress`, `ast-grep`, `qmd`) com degradação `skipped_missing_binary`.
4. **Google Stitch** (modo `stitch-mcp` + importação HTML/Tailwind) como motor de protótipo Nível 3 e fonte de tokens, normalizando para **W3C `tokens.json` + `.uzina/DESIGN.md`**, com preview sandboxed. **Figma/Penpot adiados.**
5. **`DockerExecutionWorkspace`** como segunda implementação de `ExecutionWorkspace` e **FinOps de tokens** para medir o ganho.

## Alternativas Consideradas
* **RAG vetorial puro sobre código:** descartado (proibido pela spec §5.9; falha em identificadores exatos).
* **Somente `codebase-memory-mcp`/`repomix` externos:** descartado como base (exigiria binários no `npx` zero-config); mantidos como adaptadores opcionais.
* **`bge-m3`/`jina-v3` como padrão:** mais precisos, porém 4–5× mais pesados em CPU; ficam como opção "Pro".
* **Figma MCP agora:** adiado por decisão de produto; porta `DesignPrototypeAdapter` permite adicionar depois.
* **Banco vetorial dedicado (Qdrant etc.):** descartado; `pgvector`/PGlite cobre a escala e mantém dialeto único.

## Consequências
* **Positivas:** redução esperada de 80–95% de tokens em navegação estrutural; busca precisa em PT/EN; memória de longo prazo auditável; protótipos aprovados antes do build.
* **Riscos / Trade-offs:** peso do modelo ONNX (~120 MB); manutenção do indexador AST; superfície de ataque do HTML importado; reindexação ao trocar modelo.
* **Ações de Mitigação:** carregamento lazy + cache + checksum; indexação incremental; sanitização + `iframe sandbox` + CSP; campo `embedding_model` para reindexar; testes de isolamento multi-tenant e de redação de segredos.
