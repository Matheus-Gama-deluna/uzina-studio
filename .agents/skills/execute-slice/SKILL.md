---
name: execute-slice
description: Executa um Vertical Slice da Fase 1 do Uzina Studio seguindo Plan Gate EGM, Contract-First, Spec-to-Test, Verify Gate e atualização dos artefatos de controle de fases.
---

# Skill: Execute Vertical Slice (Uzina Studio · Fase 1)

Siga estas 8 etapas em ordem estrita para cada Slice (`Slice 0` → `Slice 6`):

1. **Leitura de Contexto:**
   - Leia `docs/status/ROADMAP_STATUS.md` e `.uzina/slices-checklist.md` para identificar o próximo Slice pendente.
   - Leia as seções correspondentes em `docs/especificacao-tecnica-fase-1-v1.1.md` e os ADRs relevantes em `docs/adr/`.
2. **Dossiê do Slice (`docs/slices/slice-0X-<slug>.md`):**
   - Se o dossiê ainda não existir, crie-o a partir de `docs/slices/00-template-slice.md` listando arquivos alvo, fronteiras de pacote, contratos Zod, plano de testes e DoD.
3. **Plan Gate (EGM Seletivo):**
   - Execute `egm-implementation-readiness` sobre o dossiê do slice para eliminar decisões implícitas e lacunas.
   - Para Slices de arquitetura crítica (**Slices 0, 2, 3 e 4**), execute também `egm-design` (e `egm-zoom-out` se necessário).
   - Incorpore os ajustes no dossiê antes de criar código.
4. **Isolamento em Branch:**
   - Crie a branch `feat/slice-0X-<slug>` a partir da `main` limpa.
5. **Contract-First + Spec → Teste (RED):**
   - Crie ou atualize primeiro os schemas Zod, enums e DTOs em `packages/contracts` (`@uzina/contracts`).
   - Escreva os testes unitários (*Tests as Data* via `test.each`), testes de integração (PGlite em memória / MSW) e testes de *Contract Drift* em **arquivos dedicados por slice** (ex.: `apps/web/tests/sliceXX-*.test.ts`, evitando inflar `contract-drift.test.ts`), cobrindo os critérios de pronto (DoD) antes do código produtivo.
6. **Implementação Mínima Limpa (GREEN → REFACTOR):**
   - Para arquivos extensos (>500 linhas), use `fast-scout` (`flash_lite`) e leia apenas faixas cirúrgicas (`StartLine`/`EndLine`).
   - Valide incrementalmente com loop cirúrgico (`pnpm --filter <pacote> typecheck` e execução apenas do arquivo de teste do slice) antes de rodar a suíte completa.
   - Implemente respeitando: processo único no PGlite (`globalThis` singleton), zero `any` implícito, zero `@mastra/*-ee`, zero segredo em texto claro e Prompt Cache fixo por papel.
7. **Verify Gate (Ordem Econômica):**
   - Rode `test-critic` (`flash`) nos testes adicionados e `appsec-auditor` (`flash`) **somente quando houver** alterações em auth, cripto, rotas, uploads ou entradas externas; corrija eventuais apontamentos antes da suíte pesada.
   - **Validação Visual do Painel (`apps/web`):** Sempre que `apps/web` for alterado, suba o servidor local e acione o subagente `browser` (`Model: "flash"`) focado **apenas nas telas modificadas** para validar renderização, responsividade e ausência de erros de console/rede (`5xx`).
   - Execute `node scripts/check-no-ee.mjs`, `pnpm verify` (typecheck + lint + build + auditor de testes + testes) e `pnpm test:e2e` (quando aplicável) após o último ajuste.
   - Acione `factory-verifier` (`inherit`) **uma única vez** no encerramento para auditoria independente do `git diff` contra os requisitos.
   - Em Slices críticos (0, 2, 3 e 4), rode `egm-codebase-details` para garantir zero drift entre o dossiê/spec e o código real.
8. **Encerramento & Controle de Fases:**
   - Preencha a seção de **Evidências Reais** em `docs/slices/slice-0X-<slug>.md` com as saídas reais dos comandos.
   - Atualize `.uzina/slices-checklist.md`, `docs/status/ROADMAP_STATUS.md` e `docs/status/PROGRESS_LOG.md`.
   - Faça commit semântico em português do Brasil na branch do slice (e push/PR caso `origin` esteja configurado).
   - **Pare, recomende `/compact` (ou nova conversa ancorada em `ROADMAP_STATUS.md` / `PROGRESS_LOG.md`) e aguarde aprovação do usuário antes de iniciar o Slice N+1.**
