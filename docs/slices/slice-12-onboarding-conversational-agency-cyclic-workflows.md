# Dossiê do Slice 12 — Guia de Prontidão, Central Conversacional de Agentes & Motor Autônomo Cíclico

* **Status:** `Concluído`
* **Branch:** `feat/slice-12-autonomous-agency-chat-onboarding`
* **Estratégia Aplicada:** *Contract-First + Domain-First + Vertical Slice*
* **Spec de Referência:** `docs/especificacao-produto-arquitetura-v2.10.md` · `docs/especificacao-tecnica-fase-2-v1.0.md`

---

## 1. Objetivo e Escopo Estrito
**Entrega:** Transformar a experiência inicial e diária da Torre de Controle (`/app`) em uma **Empresa de Engenharia de Software com IA orientada por Chat e Workflows Cíclicos Inteligentes**:
1. **Guia Interativo de Prontidão & Setup (`SystemReadinessStatus`):** Checklist em tempo real que orienta o usuário sobre o que precisa configurar (Cofre de Provedores LLM AES-256-GCM, Motores de Memória/AST/Workspace em `/app/finops`, e início do primeiro projeto via Chat).
2. **Central Conversacional Multi-Agente por Momento do Projeto:** Em vez de exigir criação manual de entregas via formulários, o usuário conversa no chat principal com o **Agente Responsável pela fase atual** (`product_discovery`, `software_architect`, `ux_designer`, `tech_lead`, `qa_appsec`, `orchestrator`):
   - **Caminho Greenfield (Sistema do Zero):** O Agente de Descoberta & Produto capta a ideia, cria o projeto, grava especificações na Memória QMD e gera/organiza automaticamente as entregas (`deliverables`) no quadro.
   - **Caminho Brownfield (Repositório Existente via URL Git ou Caminho Local):** O Agente Arquiteto & Codebase recebe uma **URL Git remota (`https://...`)** ou caminho local, vincula/clona com segurança para `${UZINA_DATA_DIR}/repos/<projectId>/<slug>`, roda o Brownfield Scan + Indexação AST Poliglota, registra o diagnóstico na Memória QMD e estrutura as entregas automaticamente.
3. **Motor Autônomo Cíclico & Portões Inegociáveis:**
   - Sabe **quando avançar** entregas autonomamente sem pular nenhuma fase obrigatória da máquina de estados (`getAllowedNextStatuses`), **quando pausar** (em `decision_pending` / portão HITL ou risco alto) e **quando rodar em ciclo** (voltando ao `software_architect` ou `product_discovery` ao iniciar uma nova fase/onda de evolução do projeto).

## 2. Fronteiras de Pacotes e Arquivos Previstos
- `packages/contracts/src/agency.ts` + export em `packages/contracts/src/index.ts`
- `packages/contracts/tests/slice12-agency-contracts.test.ts`
- `packages/mastra-runtime/src/agency.ts` + export em `packages/mastra-runtime/src/index.ts`
- `packages/mastra-runtime/tests/slice12-agency.integration.test.ts`
- `apps/web/src/app/api/agency/status/route.ts` e `apps/web/src/app/api/agency/chat/route.ts`
- `apps/web/src/components/agency-command-center.tsx` integrado a `apps/web/src/components/workspace-board.tsx`
- `apps/web/src/mocks/{fixtures.ts,handlers.ts}` + `apps/web/tests/contract-drift.test.ts`

## 3. Critérios de Pronto (DoD)
- [x] Contratos Zod (`AgencyChatRequestSchema`, `AgencyChatResponseSchema`, `AgencyOverviewResponseSchema`, validação anti-IMDS `HttpUrlSchema` para `gitUrl`) testados em `@uzina/contracts`
- [x] Fluxos Greenfield (do zero), Brownfield (URL Git remota + scan + AST poliglota), avanço autônomo sem pular fases com parada em `decision_pending` e retorno cíclico ao Arquiteto testados em PGlite real
- [x] Rotas `/api/agency/status` e `/api/agency/chat` protegidas por RBAC e validadas no `contract-drift.test.ts`
- [x] Guia de Prontidão + Central Conversacional Multi-Agente + Inspetor Duplo de Artefatos (Longo Prazo & Slices) visíveis em `/app` e validados via `browser` em `http://localhost:3000/app`
- [x] Verify Gate completo (`0` violações no `audit-tests`, `0` falhas)

## 4. Evidências Reais Pós-Código (Verify Gate)
- `node scripts/check-no-ee.mjs` -> exit `0`
- `node scripts/audit-tests.mjs` -> `Arquivos: 65 | Testes: 199 | Suprimidos: 2 | Violações: 0`
- `Vitest` (9 pacotes com PostgreSQL 16 + `pgvector` live): `65` arquivos de teste, `494 passed | 0 skipped`
- `pnpm --filter @uzina/web test:e2e` -> `2 passed (26.8s)`
- QA Visual (`browser`, `flash`) em `http://localhost:3000/app`: Guia de Prontidão, Equipe com Model Tiering, Importação Brownfield via URL Git, Inspetor de Artefatos Longo Prazo & Slices, Ciclo Autônomo até Portão HITL e Retorno Cíclico (`Ciclo #2`) aprovados com `0` console errors, `0` HTTP `>= 500` e `0` overflow horizontal em Desktop Dark/Light (`1440x900`) e Mobile (`390x844`).
