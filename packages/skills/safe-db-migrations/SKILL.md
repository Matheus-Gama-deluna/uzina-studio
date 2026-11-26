---
name: safe-db-migrations
description: Use quando precisar alterar schemas Drizzle pg-core ou criar migrações SQL, garantindo padrão Expand-Migrate-Contract, compatibilidade PGlite/PostgreSQL, índices sem lock e bloqueio de DDL destrutivo.
applies_to_roles: [builder, architect, verifier]
phase: build
role_category: reference
license: Apache-2.0
version: "2.0.0"
iron_law: Nunca execute DDL destrutivo em passo único (DROP TABLE, DROP COLUMN, TRUNCATE, ADD COLUMN NOT NULL sem DEFAULT ou ALTER COLUMN TYPE destrutivo) e sempre valide migrações via scripts/check-migration-ddl.mjs e PGlite limpo.
---

# Skill: Safe Database Migrations (Expand-Migrate-Contract & Postgres/PGlite)

## Iron Law

> **Nunca crie ou aplique DDL destrutivo em passo único (`DROP TABLE`, `TRUNCATE`, `DROP COLUMN`, `ALTER COLUMN TYPE` destrutivo ou `ADD COLUMN ... NOT NULL` sem `DEFAULT`); toda alteração em tabela existente deve seguir Expand → Migrate → Contract e passar pelo script `scripts/check-migration-ddl.mjs` + banco PGlite limpo.**

Todos os schemas devem ser escritos em `drizzle-orm/pg-core` garantindo execução idêntica em **PGlite** (local/testes) e **PostgreSQL + `pgvector`** (produção).

## Entry Gate & Exit Artifact

- **Entry Gate (Entrada Obrigatória):**
  - `ArchitectBlueprintV2` especificando alteração de modelo de dados e estratégia de rollback.
  - Leitura prévia do schema atual em `packages/db/src/schema/`.
- **Exit Artifact (Saída Imutável):**
  - Schema Drizzle `pg-core` atualizado com chaves estrangeiras, índices e coluna `organizationId` onde houver escopo multi-tenant;
  - Migração SQL idempotente validada sem erros pelo script `scripts/check-migration-ddl.mjs` e aplicada em banco PGlite limpo nos testes de integração.

## Protocolo

### Step 0 — Leitura Silenciosa do Schema e Dependências
1. Leia `packages/db/src/schema/` para reutilizar tipos, convenções de UUID/timestamps e políticas de cascata.
2. Verifique via `analyze_change_impact` quais repositórios, queries e testes dependem das colunas alteradas.

### Step 1 — Padrão Expand → Migrate → Contract
1. **Expand:** adicione colunas novas como `nullable` ou com `DEFAULT` seguro; crie novos índices com `CREATE INDEX CONCURRENTLY` em produção (ou documente janela sem lock em migração SQL).
2. **Migrate:** atualize o código aplicativo para gravar no formato novo mantendo leitura retrocompatível e execute backfill em lotes idempotentes.
3. **Contract:** somente após validar que nenhuma versão antiga lê/escreve a coluna antiga, agende a remoção em entrega separada com aprovação explícita HITL.

### Step 2 — Regras PostgreSQL Multi-Tenant e Auditoria Automática
1. Toda tabela de negócio de cliente/projeto deve carregar `organizationId` indexado e paginação por cursor (`createdAt`, `id`) para listas extensas.
2. Execute `node packages/skills/safe-db-migrations/scripts/check-migration-ddl.mjs <arquivo.sql>` (ou via tool `validate_migration_safety`) antes de concluir o build.
3. Valide o fluxo completo de leitura/escrita em **PGlite em memória** sem mocks do banco.

## Red Flags (Anti-Racionalização)

| Racionalização Comum | Por que Falha | Ação Corretiva Obrigatória |
| :--- | :--- | :--- |
| "Só tem dados de teste, posso rodar DROP COLUMN direto na migração." | A mesma migração será aplicada em bancos reais de produção com dados existentes. | Separe em Expand (aditivo) e deixe o Contract para entrega posterior aprovada. |
| "Vou adicionar `NOT NULL` sem `DEFAULT` porque a tabela deve ser pequena." | Falha imediatamente se existir qualquer linha na tabela e trava escrita sob `ACCESS EXCLUSIVE`. | Crie com `DEFAULT` seguro ou `nullable` primeiro e faça backfill antes da constraint. |
| "Criei `CREATE INDEX idx_...` normal; funciona no PGlite." | Em PostgreSQL sob carga, `CREATE INDEX` sem `CONCURRENTLY` bloqueia `INSERT`/`UPDATE`/`DELETE`. | Use `CONCURRENTLY` em scripts SQL de produção ou documente o motivo em tabelas novas vazias. |
| "Já alterei o `schema.ts`, não precisa testar a migração do zero." | Divergências entre snapshot Drizzle e SQL gerado só aparecem ao rodar em banco limpo. | Rode a aplicação da migração do zero em PGlite no teste de integração. |

## Ponteiros Progressivos

- Execute [scripts/check-migration-ddl.mjs](scripts/check-migration-ddl.mjs) passando os arquivos `.sql` ou diretório de migrações para detectar DDL destrutivo e locks bloqueantes automaticamente.
- Combine com `test-quality-engineering` para validar queries Drizzle reais contra PGlite em memória.
