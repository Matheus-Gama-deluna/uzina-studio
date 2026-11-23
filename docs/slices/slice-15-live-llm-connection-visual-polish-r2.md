# Slice 15 — Conexão Real Multi-LLM, Ping de Credenciais, Prototipação Dinâmica & Polimento Visual Global (2ª Rodada)

- **Status:** Concluído
- **Branch:** `feat/slice-15-live-llm-connection-visual-polish-r2`

## 1. Escopo e Objetivos

1. **Conector Real Multi-LLM (`@uzina/mastra-runtime` & `/api/providers/test`):**
   - Descriptografar em memória a chave do Cofre (`AES-256-GCM`, `decryptSecret`) e conectar via HTTP nativo (`fetch` com `AbortSignal.timeout`) aos provedores **Google Gemini**, **OpenAI / OpenRouter / OmniRoute**, **Anthropic Direct** e **Ollama Local**.
   - Endpoint `POST /api/providers/test` para testar a conectividade e credencial de um provedor (já salvo no Cofre ou ainda em edição no modal), retornando status real, preview de resposta e latência em `ms`.
   - Integração no `handleAgencyChatScoped`: quando houver provedor ativo configurado no Cofre, invocar o LLM real correspondente ao Tier do agente (`Tier 3 Pro` / `Tier 2 Flash`), registrando a ação `invoked_live_llm` (`executionMode: "live_llm"`, `llmLatencyMs`) com fallback gracioso para `local_assisted`.
2. **Prototipação Visual Adaptada ao Domínio do Projeto:**
   - Evoluir `buildGeneratedVisualPrototypeHtml` para extrair entidades, métricas KPIs, etapas de fluxo e tabelas operacionais específicas do domínio descrito pelo usuário (ou sintetizadas pelo LLM real), eliminando o layout fixo genérico de 3 caixas.
3. **Redesign do Cofre (`/app/providers`) & Polimento Visual da 2ª Rodada (Desktop e Mobile):**
   - Auto-preenchimento de `Base URL`, placeholder de chave e modelos dos **7 papéis de agentes** ao selecionar o tipo de provedor no modal, com presets de 1 clique e botão **`Testar Conexão Real (Ping LLM)`**.
   - Badge transparente no Chat (`🟢 LLM Real Conectado` vs. `🟡 Modo Simulado Local · Conectar Chave LLM →`).
   - Eliminação da barra de abas duplicada na visão Mobile `Estúdio` (`390×844`).
   - Botão consistente **`← Voltar ao Chat do Projeto`** e alvos de toque `>= 36px` (`min-h-9`) em `/app/providers`, `/app/decisions`, `/app/security`, `/app/memories`, `/app/finops`, `/studio`, `/code`, `CommandPalette ⌘K` e `CopilotDrawer`.

## 2. Critérios de Pronto (DoD)

- [x] `node scripts/check-no-ee.mjs` -> `0`
- [x] `node scripts/audit-tests.mjs` -> `0 violações`
- [x] Contratos Zod e testes unitários/integração em `@uzina/contracts`, `@uzina/mastra-runtime` e `@uzina/web` (`contract-drift.test.ts`) -> `PASS`
- [x] `pnpm --filter @uzina/web build` e `pnpm --filter @uzina/web test:e2e` -> `2 passed`
- [x] Validação visual e interativa no `browser` (Desktop `1440×900` e Mobile `390×844`).
