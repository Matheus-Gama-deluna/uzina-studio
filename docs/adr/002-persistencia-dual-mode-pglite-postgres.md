# ADR-002: Persistência Dual-Mode (`PGlite` Single-Process `Symbol.for` → `PostgreSQL`)

* **Status:** Aceita (Atualizada após revisão EGM Design Critic)
* **Data:** 2026-11-21
* **Contexto de Origem:** Fase 0 / Slice 0 — Walking Skeleton

## Contexto
O Uzina Studio precisa rodar **zero-config no PC local** (sem exigir Docker/PostgreSQL pré-instalado) e escalar com **1 linha de configuração (`DATABASE_URL`) para PostgreSQL + `pgvector` em VPS**, mantendo um único dialeto Drizzle (`drizzle-orm/pg-core`).

O PGlite (`@electric-sql/pglite`) opera em modo *single-connection* sobre o diretório `${UZINA_DATA_DIR}/pgdata`: abrir duas instâncias contra o mesmo diretório em processos ou conexões concorrentes corrompe ou trava o banco. Adicionalmente, no Next.js em desenvolvimento (`next dev` com HMR) ou em builds, módulos podem ser recarregados ou executados em workers separados se não houver guarda explícita.

## Decisão
1. **Seleção Dual-Mode Determinística com Fail-Fast em `@uzina/db`:**
   * Quando `DATABASE_URL` estiver **ausente ou vazia após `.trim()`**, `@uzina/db` opera em modo **`pglite`** (`drizzle-orm/pglite`) usando `${UZINA_DATA_DIR}/pgdata` (ou `:memory:` quando `UZINA_DATA_DIR=":memory:"` ou opção explícita).
   * Quando `DATABASE_URL` estiver **preenchida**, ela deve ser uma URI válida com protocolo `postgres://` ou `postgresql://` (validada por parser de URL/Zod), ativando o modo **`postgres`** (`drizzle-orm/node-postgres` com `pg.Pool`). Qualquer string preenchida inválida dispara erro **fail-fast** no boot (evitando fallback silencioso para PGlite efêmero em produção).
2. **Singleton `Symbol.for("@uzina/db/singleton")`, Auto-Recuperação e Shutdown:**
   * O singleton é armazenado em `(globalThis as Record<symbol, unknown>)[Symbol.for("@uzina/db/singleton")]`.
   * Se `initPromise` rejeitar durante o cold start (ex.: Postgres ainda inicializando), o bloco `.catch()` limpa `initPromise = undefined` para evitar *poisoned promise* permanente.
   * Exposição de `closeDb()` + registro idempotente de `SIGINT`/`SIGTERM` para flush limpo do WAL do PGlite e fechamento do `pg.Pool`.
3. **Migrações Programáticas no Cold Start:**
   * SQL migrations versionadas via `drizzle-kit generate` em `packages/db/drizzle/` são aplicadas automaticamente de forma idempotente dentro de `initPromise` (`migrate()`), protegidas no modo PostgreSQL por `pg_advisory_lock`.
4. **Restrições Next.js & Processo Único Local:**
   * `apps/web/next.config.ts` declara `serverExternalPackages: ["@electric-sql/pglite", "pg"]`.
   * Rotas e Server Components que acessam `@uzina/db` declaram `export const runtime = "nodejs"` e `export const dynamic = "force-dynamic"`.
   * No modo local (`!DATABASE_URL`), o Painel Next.js e o Mastra Runtime executam sempre no mesmo processo Node.js. A CLI standalone (`uzina sec scan`) nunca abre `./data/pgdata` diretamente enquanto o servidor estiver ativo.
5. **Política Transparente de Testes:**
   * **Obrigatório sempre (`pnpm verify`):** `setupFiles` do Vitest define `UZINA_DATA_DIR=":memory:"` por default (isolando workers paralelos); testes que validam persistência em disco usam diretório temporário exclusivo (`os.tmpdir()`).
   * **Obrigatório quando disponível (`TEST_DATABASE_URL`):** suíte live contra PostgreSQL + `pgvector` (`describe.skipIf(!process.env.TEST_DATABASE_URL)`), nunca reportando falso verde quando ausente.

## Consequências
* **Positivas:** Zero-config real sem CLI manual de migração; proteção contra `ENOENT` de WASM no Next.js, *poisoned promises*, colisão de workers Vitest e fallback silencioso perigoso em produção.
* **Riscos / Trade-offs:** Em Windows com workspace dentro do OneDrive, se `UZINA_DATA_DIR` resolver para caminho contendo `"OneDrive"`, o startup emite aviso explícito no log recomendando configurar `UZINA_DATA_DIR` fora do OneDrive.
