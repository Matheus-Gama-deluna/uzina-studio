---
name: safe-db-migrations
description: Impõe migrações seguras Expand-Migrate-Contract e bloqueia DDL destrutivo em passo único.
applies_to_roles: [builder, verifier]
---

# Skill: Safe Database Migrations

## Regras Obrigatórias
1. **Padrão Expand → Migrate → Contract:** Toda alteração de schema em tabelas com dados deve ser aditiva e retrocompatível primeiro.
2. **Bloqueio de DDL destrutivo:** Nunca gere `DROP TABLE`, `TRUNCATE`, `DROP COLUMN` ou `ALTER COLUMN TYPE` destrutivo em passo único sem guard e aprovação explícita na Caixa de Decisões.
3. **Dialeto PostgreSQL único:** Escreva schemas Drizzle em `pg-core` compatíveis tanto com PGlite (local) quanto com PostgreSQL (VPS).
4. **Validação:** Toda migração deve ser aplicada e validada em banco limpo durante o `.uzina/verify`.
