---
trigger: always_on
---

# Regras Permanentes de Workspace — Uzina Studio

Ao atuar neste repositório, siga rigorosamente estas regras em todas as tarefas:

1. **Leia `AGENTS.md`, `docs/status/ROADMAP_STATUS.md` e `docs/especificacao-tecnica-fase-1-v1.1.md` antes de planejar qualquer alteração.**
2. **Trabalhe estritamente dentro do escopo do Slice ativo** em `.uzina/slices-checklist.md` e `docs/slices/slice-0X-*.md`. Não antecipe funcionalidades de Slices futuros nem da Fase 2/3.
3. **Respeite as fronteiras de importação do monorepo** (Seção 3 da Spec Técnica):
   - `@uzina/contracts` (`packages/contracts`) não importa nenhum pacote interno.
   - `@uzina/db` (`packages/db`) e `@uzina/core` (`packages/core`) importam apenas `@uzina/contracts`.
   - `@uzina/opencode-bridge` e `@uzina/security-engine` importam apenas `@uzina/contracts` e `@uzina/core`.
   - `@uzina/mastra-runtime` orquestra os pacotes acima.
4. **Nunca instale pacotes `@mastra/*-ee`** nem use módulos `ee/`. Rode `node scripts/check-no-ee.mjs` sempre que alterar `package.json` ou dependências.
5. **Pinagem estrita:** mantenha `save-exact=true` no `.npmrc` e use `pnpm` com `--frozen-lockfile` no CI.
6. **Testes úteis, não inflados:** escreva testes derivados dos contratos Zod/Spec antes da implementação; use PGlite em memória para integração de banco e MSW na borda de rede para o frontend; consolide casos repetitivos com `test.each`.
7. **Controle de Fases & Evidência Real:** não declare conclusão sem saída real de `pnpm verify` (ou checks equivalentes da fase). Ao concluir um Slice, atualize obrigatoriamente o Dossiê do Slice, `.uzina/slices-checklist.md`, `docs/status/ROADMAP_STATUS.md` e `docs/status/PROGRESS_LOG.md`.
8. **Economia de Tokens & Aceleração de Entrega:**
   - Durante o TDD, valide primeiro de forma cirúrgica (`pnpm --filter <pacote> typecheck` + `npx vitest run <arquivo>` ou `pnpm --filter <pacote> test -- <arquivo>`) e rode `pnpm verify` / `pnpm test:e2e` apenas após concluir as edições e correções de revisão.
   - Em arquivos extensos (>500 linhas, como `agency.ts`, `deliverable-lifecycle.ts`, `deliverables-docs-hub.tsx` e `contract-drift.test.ts`), delegue o mapeamento ao `fast-scout` (`flash_lite`) e leia apenas faixas cirúrgicas (`StartLine`/`EndLine`).
   - Crie arquivos de teste dedicados por slice (`apps/web/tests/sliceXX-*.test.ts` ou no pacote alvo) em vez de inflar `apps/web/tests/contract-drift.test.ts`.
   - Ordene revisões com economia: `test-critic` (`flash`) + `appsec-auditor` (`flash`, somente se houver auth/cripto/rotas/uploads) → correções → `pnpm verify` → `factory-verifier` (`inherit`) **1x** no encerramento; QA no `browser` (`flash`) focado nas telas alteradas.
   - Após o merge de um Slice, recomende `/compact` ou nova conversa ancorada em `docs/status/ROADMAP_STATUS.md` e `docs/status/PROGRESS_LOG.md`.
