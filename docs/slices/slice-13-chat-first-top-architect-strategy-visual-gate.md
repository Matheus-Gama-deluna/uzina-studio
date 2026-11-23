# Dossiê do Slice 13 — Redesign Chat-First no Topo, Estratégia Decidida pelo Arquiteto, Topologia de Equipe (Enxuta vs Completa) & Portão de Prototipação Visual

* **Status:** `Concluído`
* **Branch:** `feat/slice-13-chat-first-architect-strategy-visual-gate`
* **Estratégia Aplicada:** *Contract-First + Frontend-First (MSW) + Vertical Slice*
* **Spec de Referência:** `docs/especificacao-produto-arquitetura-v2.10.md` · `docs/especificacao-tecnica-fase-2-v1.0.md`

---

## 1. Objetivo e Escopo Estrito
**Entrega:**
1. **Layout Chat-First no Topo de `/app` + Configuração Integrada:**
   - O **Chat Conversacional** sobe para a primeira dobra da Torre de Controle (`7/12` da largura, histórico amplo e composer `<textarea>` multilinha único sem mini-formulários fragmentados).
   - O **Guia de Prontidão & Setup** fica integrado como uma barra compacta e expansível no próprio cabeçalho do Chat (sem empurrar o chat para o rodapé).
2. **Novo Projeto 100% Conversacional & Estratégia Decidida pelo Arquiteto (`decideOptimalAiStrategy`):**
   - Elimina a exigência de o usuário escolher `Estratégia Padrão` ao criar um projeto.
   - O **Agente Arquiteto de Software** analisa tudo o que foi conversado (ou o repositório Git) e decide automaticamente a melhor estratégia para execução por agentes de IA (`api_contract_first`, `frontend_first_msw`, `domain_first`, `data_schema_first`, `characterization_strangler`), registrando a justificativa técnica (`strategyRationale`).
3. **Topologia de Equipe Adaptativa (`TeamTopologyMode`: `lean_mvp` vs `full_enterprise`):**
   - **`lean_mvp` (Equipe Enxuta & Rápida — 3 Agentes Core):** `Produto & Descoberta`, `Arquiteto & Design Lead`, `Engenheiro Full-Stack & Verifier` — ideal para MVPs e velocidade máxima mantendo qualidade e contratos.
   - **`full_enterprise` (Equipe Completa — 6 Especialistas):** `Supervisor Executivo`, `Descoberta & Produto`, `Arquiteto de Software`, `Design & UX`, `Tech Lead & Builder`, `Auditor QA & AppSec`.
4. **Integração do Estúdio & Fase de Prototipação Visual no Painel (`Visual Flow Gate`):**
   - Gera e vincula automaticamente um **Protótipo Visual Vivo (`design_prototypes` HTML/Tailwind + Tokens W3C + `.uzina/DESIGN.md`)** a partir da conversa no Chat.
   - Aba dedicada **`Estúdio & Protótipo Visual`** ao lado do Chat com preview `<iframe sandbox="">` ao vivo, tokens de cor/tipografia e ações diretas para **`Aprovar Fluxo Visual para Codificação`** ou **`Pedir Ajuste no Protótipo via Chat`**.
   - Guardrail no Ciclo Autônomo: entregas com UI (`hasUi: true`) pausam no portão `visual_studio` caso o fluxo visual ainda não tenha sido aprovado, garantindo que o sistema nasça codificado com um fluxo visual aprovado pelo usuário.

## 2. Fronteiras de Pacotes e Arquivos Previstos
- `packages/contracts/src/agency.ts` + `packages/contracts/tests/slice12-agency-contracts.test.ts`
- `packages/mastra-runtime/src/agency.ts` + `packages/mastra-runtime/tests/slice12-agency.integration.test.ts`
- `apps/web/src/components/agency-command-center.tsx` e `apps/web/src/components/workspace-board.tsx`
- `apps/web/src/mocks/{fixtures.ts,handlers.ts}` + `apps/web/tests/contract-drift.test.ts`

## 3. Critérios de Pronto (DoD)
- [x] Contratos Zod (`TeamTopologyModeSchema`, `ArchitectStrategyDecisionSchema`, `ProjectVisualFlowSummarySchema`, intents `approve_visual_flow` e `revise_visual_flow`) testados em `@uzina/contracts`
- [x] `decideOptimalAiStrategy` do Arquiteto decidindo estratégia + justificativa a partir da conversa/Git e gerando protótipo visual inicial em `design_prototypes`
- [x] Guardrail visual pausando entregas `hasUi: true` em `visual_studio` até aprovação do protótipo visual
- [x] Chat amplo no topo da primeira dobra de `/app`, composer `<textarea>` único, alternância `Equipe Enxuta (MVP)` vs `Equipe Completa (6)` e aba `Estúdio & Protótipo` com preview `<iframe sandbox="">` validados no `browser`
- [x] Verify Gate completo (`0` violações no `audit-tests`, `0` falhas, Playwright E2E `2 passed`)

## 4. Evidências Reais Pós-Código (Verify Gate)
- `node scripts/check-no-ee.mjs` -> exit `0`
- `node scripts/audit-tests.mjs` -> `Arquivos: 65 | Testes: 199 | Suprimidos: 2 | Violações: 0`
- `Vitest` (9 pacotes): `65` arquivos de teste, `495 passed | 0 skipped`
- `pnpm --filter @uzina/web test:e2e` -> `2 passed (13.4s)`
- QA Visual (`browser`, `flash`) em `http://localhost:3000/app`: Chat na primeira dobra (`y = 225.6px`), toggle `Equipe Enxuta (MVP · 3)` vs `Completa (6)`, criação de `OdontoFlow IA` com estratégia decidida pelo Arquiteto (`Frontend-First + MSW`), preview `<iframe sandbox="">` do protótipo visual e aprovação do Portão Visual validados com `0` console errors, `0` HTTP `>= 500` e `0` overflow horizontal em Desktop Dark/Light (`1440x900`) e Mobile (`390x844`).
