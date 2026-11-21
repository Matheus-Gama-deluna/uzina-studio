# ADR-001: Identidade Oficial do Projeto (**Uzina Studio**) e Reconciliação das Specs

* **Status:** Aceita
* **Data:** 2026-11-21
* **Contexto de Origem:** Fase 0 — Bootstrap & Governança

## Contexto
Os documentos originais do kit (`especificacao-produto-arquitetura-v2.10.md` e `especificacao-tecnica-fase-1-v1.1.md`) utilizavam placeholders genéricos (`@factory/*`, CLI `factory`, pasta `.factory/`, variável `FACTORY_DATA_DIR`). Além disso, há pequenas diferenças naturais entre a visão completa de 3 fases (v2.10, que lista 22 tabelas conceituais) e o corte executável da Fase 1 (v1.1, que consolida 13 tabelas e as 8 skills presentes em `packages/skills/`). Por fim, regras globais antigas mencionavam Firebase Hosting para preview de PRs, incompatível com uma aplicação Node/Next.js + PGlite/Postgres self-hosted.

## Decisão
1. **Nome e Convenções Oficiais:**
   * **Produto:** **Uzina Studio**
   * **Pacotes do Monorepo:** `@uzina/*` (`@uzina/contracts`, `@uzina/db`, `@uzina/core`, `@uzina/opencode-bridge`, `@uzina/security-engine`, `@uzina/mastra-runtime`, `@uzina/ui`)
   * **Binário CLI:** `uzina` (`uzina start`, `uzina dev`, `uzina sec scan`, `uzina db migrate-to-postgres`)
   * **Pasta de Governança/Artefatos:** `.uzina/` (`steering.md`, `DESIGN.md`, `slices-checklist.md`, `verify.ts`)
   * **Variável de Dados Locais:** `UZINA_DATA_DIR` (default `./data`), aceitando fallback opcional para `FACTORY_DATA_DIR` apenas se `UZINA_DATA_DIR` não estiver definida, para facilitar compatibilidade com ambientes antigos.
2. **Fonte Autoritativa da Fase 1:**
   * A **Especificação Técnica Fase 1 v1.1** (`docs/especificacao-tecnica-fase-1-v1.1.md`) é a fonte autoritativa para escopo, 13 tabelas Drizzle, APIs e critérios de pronto dos Slices 0 a 6.
   * A **Especificação de Produto v2.10** (`docs/especificacao-produto-arquitetura-v2.10.md`) permanece como referência de visão e direcionamento para Fases 2 e 3.
   * As 8 skills em `packages/skills/*/SKILL.md` permanecem preservadas exatamente com seus nomes de diretório originais, adaptadas apenas nas referências internas de `.factory/` → `.uzina/`.
3. **Fluxo de CI/Entrega:**
   * Este repositório utiliza branches `feat/slice-0X-...`, `pnpm verify`, Pull Requests no GitHub e GitHub Actions (CI + GHCR + npm no Slice 6), **sem Firebase Hosting**.

## Consequências
* **Positivas:** Identidade única consistente em todo o código, CLI, UI e docs; zero ambiguidade sobre qual tabela ou skill pertence à Fase 1 vs. Fases 2/3.
* **Trade-offs:** As especificações originais em `docs/especificacao-*.md` mantêm os termos históricos `factory`/.`factory/` para preservação documental; este ADR serve de tabela oficial de tradução.
