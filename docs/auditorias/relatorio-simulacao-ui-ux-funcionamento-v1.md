# Relatório de Auditoria, Teste e Simulação Full-Live — Uzina Studio (Pós-Slice 38)

> **Escopo:** Análise empírica de **UI/UX** e **Funcionamento Full-Live** sob PostgreSQL 16 (`pgvector`), Docker `29.10.0` (WSL2 Ubuntu), Google Gemini API real (Cofre AES-256-GCM + STT + Chat SSE), scanners SAST nativos/containerizados (`uzina-studio:verify`), Chromium Multi-Viewport e matrizes adversas de RBAC, SSRF, SSE e concorrência.
> **Regra de Auditoria:** Diagnóstico puro em campo (zero alteração de código produtivo nesta rodada) + criação de 4 suítes automatizadas permanentes (`sim-arc1` a `sim-arc4`).

---

## 1. Sumário Executivo & Scorecard (0–100)

| Dimensão Auditada | Nota | Veredito | Síntese Objetiva |
| :--- | :---: | :---: | :--- |
| **UI & Sistema Visual Warm Stone (`.uzina/DESIGN.md`)** | **90 / 100** | Forte | Disciplina 90/10, `tabular-nums`, dual-theme Dark/Light e escalas `A-\|A\|A+` funcionam com 0 overflow; pequenos ajustes pendentes em `accentCtaCount` (`/app/studio`, `/app/settings`) e `Sincronizando...` na sidebar. |
| **UX, Carga Cognitiva & Superfícies** | **78 / 100** | Bom c/ Lacuna | Separação em 4 momentos (`/ideas` → `/app` → `/studio` → `/deliverables`) é clara para perfis técnicos, mas `/exec` ainda redireciona para `/app` sem superfície executiva dedicada. |
| **Acessibilidade (WCAG) & Mobile PWA (`390×844`)** | **88 / 100** | Forte | Zero overflow horizontal em `1440×900`, `768×1024` e `390×844` em todas as rotas; `Cmd+K`/`Escape` funcionam; breadcrumb mobile trunca (`Chat da ...`) devido à densidade da topbar. |
| **Orquestração Agêntica Real (Google Gemini)** | **82 / 100** | Bom c/ Bug P1 | Ping LLM (`857ms`) e Chat SSE (`122ms` TTFB, `6.4s` total) operam bem com Cofre AES-256-GCM, porém `/api/voice/transcribe` vaza blocos `thought` do `gemini-2.5-flash` no texto transcrito (P1) e TTS cai em `browser_speech`. |
| **Codebase Intel (AST Poliglota & QMD Híbrido)** | **85 / 100** | Bom c/ Bug P1 | Indexador AST indexou `.ts`, `.py` e `.sql` em `54ms` (`61.3%` economia) e QMD achou `ADR-010` no Top-1 em `23ms`; porém botão UI de reindexação em `/app/memories` omite `projectId` (P1). |
| **Isolamento Docker Workspace & Git Worktrees** | **74 / 100** | Atenção (P1) | Hardening (`--cap-drop ALL --network none --read-only --user 1001:1001`) validado com `ORPHANS_AFTER=0` em `node:22-slim`, porém `DEFAULT_DOCKER_WORKSPACE_IMAGE` usa digest SHA-256 inexistente no Docker Hub (P1). |
| **AppSec SAST, RBAC Multi-Tenant & Guardrails** | **84 / 100** | Forte c/ Bug P1 | `17/17` casos de IDOR, RBAC `auditor`, SSRF e Prompt Injection bloqueados; Gitleaks e OSV-Scanner operam no container oficial, mas `opengrep` falha sem `--config` local (P1) e `trivy-db` requer 138 MiB de rede. |
| **Resiliência SSE, Orçamento & Concorrência** | **94 / 100** | Excelente | Retomada SSE `Last-Event-ID`/`afterEventId` determinística, `Abort` em voo, `budget_cap_pause` e fila AST `SymbolLockManager` 100% comprovados em PGlite e PostgreSQL 16. |

**Média Global Composta:** **84.4 / 100** — Base arquitetural madura, segura em isolamento de dados e resiliente em workflows, com **4 bugs reais de integração P1** descobertos exclusivamente graças à execução **Full-Live**.

---

## 2. Auditoria de UI, UX & Acessibilidade (4 Passes · `ui-visual-qa-critic`)

### 2.1. Matriz Multi-Viewport, Temas & Escala Tipográfica (`A- | A | A+`)
Inspeção automatizada e visual via Chromium (`scripts/qa-sim/visual-audit-probe.mjs` + suíte permanente [sim-arc1-ui-states-a11y-mobile.spec.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/e2e/sim-arc1-ui-states-a11y-mobile.spec.ts)) sobre as rotas operacionais:

| Rota | Desktop `1440×900` Overflow | Tablet `768×1024` Overflow | Mobile `390×844` Overflow | CTAs `bg-accent` | Elementos `.tabular-nums` | Erros Console/Rede |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `/app` | Não (`1440px`) | Não | Não | `1` | `4` | `0` |
| `/app/ideas` | Não | Não | Não | `1` | `2` | `0` |
| `/app/studio` | Não | Não | Não | `2` *(ver 2.2)* | `2` | `0` |
| `/app/deliverables` | Não | Não | Não | `1` | `5` | `0` |
| `/app/decisions` | Não | Não | Não | `0` *(empty)* | `1` | `0` |
| `/app/memories` | Não | Não | Não | `1` | `1` | `0` |
| `/app/providers` | Não | Não | Não | `1` | `1` | `0` |
| `/app/security` | Não | Não | Não | `1` | `1` | `0` |
| `/app/finops` | Não | Não | Não | `1` | `56` | `0` |
| `/app/settings` | Não | Não | Não | `2` *(ver 2.2)* | `1` | `0` |
| `/offline` | Não | Não | Não | `1` | `0` | `0` |

**Escalas Tipográficas no Chat Principal (`/app`, `1440×900`):**
- `A-` (`compact`): `Enviar Mensagem` termina em `y+h = 870px <= 900px` (`overflowX: false`).
- `A` (`comfortable`): `Enviar Mensagem` termina em `y+h = 867px <= 900px` (`overflowX: false`).
- `A+` (`large`, `112.5%`): `Enviar Mensagem` termina em `y+h = 863px <= 900px` (`overflowX: false`).

### 2.2. Achados Visuais e de UX Observados nas Screenshots Reais
1. **Regra `90/10` (`<= 1` CTA âmbar por tela):** cumprida em `/app`, `/app/ideas`, `/app/deliverables`, `/app/memories`, `/app/providers`, `/app/security`, `/app/finops` e `/offline`. Em `/app/studio` e `/app/settings` o auditor de DOM detectou `2` elementos visíveis com classe `bg-accent` (indicando competição sutil de acento secundário ou toggle ativo).
2. **Flash de Hidratação na Sidebar (`/app/finops` Light Mode):** durante transição de rota, o `Project Switcher` exibe brevemente *"Sincronizando... / Carregando projetos"* e mantém os itens de *PROJETO ATIVO* visualmente desabilitados até o `react-query` resolver.
3. **Redundância de Controles em `/app/finops`:** existem **2 botões `Atualizar`** simultâneos na mesma dobra/página (um no cabeçalho de *FinOps de Tokens & Isolamento* e outro no subpainel *Efetividade Agêntica por Papel*).
4. **Compressão de Breadcrumb em Mobile (`390×844`):** na topbar mobile, o agrupamento `A- | A | A+` + Sino + Co-piloto + `Cmd+K` + Tema deixa pouco espaço para o título da rota, truncando *"Chat da Engenharia"* para *"Chat da ..."*; além disso, ao abrir o Bottom Sheet `Navegação & Sistema`, o conteúdo inicial exige rolagem vertical dentro do drawer para alcançar itens inferiores.
5. **Dense State (`25+` entregas) e `/offline`:** validados via Playwright (`sim-arc1`), com renderização limpa de 25 entregáveis simultâneos sem estourar largura de container e recuperação limpa pós-offline.
6. **Barreira de Persona Não-Técnica (`/exec`):** [page.tsx](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/src/app/exec/page.tsx) redireciona `/exec` → `/app`. Um usuário executivo/negócio acaba exposto diretamente ao vocabulário de engenharia (`Modo: architect`, `AST`, `AppSec`, `FinOps`), contrariando a separação Dual-Surface definida em [.uzina/DESIGN.md](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/.uzina/DESIGN.md#L64-L66).

---

## 3. Resultados Empíricos Full-Live (PostgreSQL 16 + Gemini + Docker + SAST)

### 3.1. Arco 1 — Fundador & Voz (`Clínica VidaPlena`, Greenfield)

| Etapa / Endpoint | Status | Latência | Resultado Observado |
| :--- | :---: | :---: | :--- |
| `GET /api/health/details` | `200` | `0.78 ms` (DB) | `database.mode: "postgres"`, `auth: "configured"`, `pwaEnabled: true`, `vapidConfigured: true` |
| `POST /api/providers` + `POST /api/providers/test` | `201` / `200` | `857 ms` | Chave cifrada em AES-256-GCM (`keyPreview: "AQ....L89g"`), Gemini `gemini-2.5-flash` respondeu `"Online."` |
| `POST /api/share` (Share Target PWA) | `303` | `< 20 ms` | Redirecionou corretamente para `/app/ideas?sharedTitle=...&sharedText=...` |
| `POST /api/voice/transcribe` (WAV → `gemini-2.5-flash`) | `200` | `4192 ms` | **Bug P1 detectado:** retornou `think\nThe user wants an exact transcription...` antes de `"Hum"` (leak de *thinking*) |
| `POST /api/voice/speak` (`google` no Cofre) | `200` | `26 ms` | Retornou `{ fallback: "browser_speech", reason: "provider_uses_browser_speech" }` |
| `POST /api/agency/chat/stream` (SSE Gemini) | `200` | `122 ms` TTFB / `6395 ms` total | `18` eventos SSE, resposta contextualizada de descoberta + `spokenSummary` de `304` chars |
| `POST /api/projects/[id]/prototypes` + `/preview` | `201` / `200` | — | `<script>` e `onerror=` 100% removidos do HTML servido; domínio *Healthtech* inferido na UI |
| `POST /api/notifications/test` + `GET /api/notifications` | `200` / `200` | — | Persistiu alerta e retornou `unreadCount: 1` no PostgreSQL |

### 3.2. Arco 2 — Tech Lead Brownfield (`LegacyPay Gateway`) vs. `gabarito.json`

| Mecanismo | Esperado (`gabarito.json`) | Obtido em Campo (Full-Live) | Veredito |
| :--- | :--- | :--- | :---: |
| **AST Poliglota** (`/codebase/reindex`) | Indexar símbolos `.ts`, `.py` e `.sql` | `5` arquivos, `8` símbolos, `7` arestas, `581 → 225` tokens (**`61.3%` economia**) em `54 ms`; UI e `/entropy` exibiram `processPaymentCapture`, `LedgerReconciler`, `settle_batch` e `merchant_accounts` | ✅ Passou |
| **Memória Híbrida QMD** (`/memories/search`) | Recuperar `adr-010-idempotency-keys.md` no Top-3 | **Top-1** (`ADR-010: Chaves de Idempotência na Captura de Pagamentos > Decisão`) em `23 ms` (`deterministic-trigram-384`), porém apenas com `projectId` explícito na API (botão UI omite `projectId`) | ⚠️ Bug P1 na UI |
| **Migration Safety** (`db/002_unsafe_drop.sql`) | Bloquear `DROP COLUMN` + alertar `CREATE INDEX` | `passed: false`, `no_drop_column` (`blocking`, linha 2) + `create_index_without_concurrently` (`warning`, linha 3) | ✅ 100% |
| **DockerExecutionWorkspace** (WSL2 `docker 29.10`) | Container isolado sem root/rede e zero órfãos | `DEFAULT_DOCKER_WORKSPACE_IMAGE` (`@sha256:9f241c...`) falhou pull (`not found`); com `node:22-slim`, rodou `test ok` sob `--cap-drop ALL --network none --read-only --user 1001:1001` com `ORPHANS_AFTER=0` | ⚠️ Bug P1 no Digest |
| **Scanners Nativos** (`@uzina/security-engine`) | Detectar token fake + DDL inseguro | `native_secrets` = `1` finding (`config/legacy-webhook.env.sample`), `native_ddl` = `1` finding (`db/002_unsafe_drop.sql`), `4` scanners externos = `skipped_missing_binary` no Windows | ✅ Esperado no Win |
| **Scanners Container Oficial** (`uzina-studio:verify`) | 4 scanners executando contra `LegacyPay` | • `gitleaks 8.24.2`: **1/1** (`github-pat` em `208 ms`)<br>• `osv-scanner 2.0.0`: detectou CVEs em `axios@0.21.1` e `lodash@4.17.15`<br>• `trivy 0.76.2`: exige download inicial de `trivy-db:2` (`138.69 MiB`)<br>• `opengrep 2.0.0`: **falhou (`EXIT=2`)** tentando baixar `semgrep.dev/c/p/default` | ⚠️ Bug P1 no Opengrep |

### 3.3. Arcos 3 & 4 — Auditoria Adversa (PGlite & PostgreSQL 16 `uzina_sim_test`)
- **Multi-Tenant IDOR (`sim-arc3`, `17/17` passed em PGlite e Postgres):** bloqueio `403`/`404` em `/deliverables`, `/codebase`, `/worktrees`, `/decisions/[id]/resolve`, `/assets/[id]`, e isolamento silencioso (`0` itens / `readAt: null`) em `/agency/threads`, `/memories/search` e `/notifications/read`.
- **RBAC `auditor` Read-Only (`sim-arc3`):** leitura liberada (`200`) em `/providers`, `/security/scans` e `/finops/config`; mutações bloqueadas com `403` no Cofre, Decisões HITL, Merge Git e FinOps Config.
- **Anti-SSRF & Prompt Injection (`sim-arc3`):** rejeição `400` para Google provider `127.0.0.1`, GitHub PAT fora de `api.github.com` e DAST `169.254.169.254`; `scanAgenticPromptInjectionNative` detectou payloads em `AGENTS.md` e `SKILL.md`.
- **Reconexão SSE, Abort, Budget Cap & AST Lock (`sim-arc4`, `4/4` passed em PGlite e Postgres):** `Last-Event-ID` e `afterEventId` retomaram exatamente após o cursor na ordem `(createdAt, id)`; `workflow/abort` persistiu `status: "paused"` (`pausedFromStatus: "building"`); teto `budgetCapUsd: 0.001` suspendeu em `budget_cap_pause`; `SymbolLockManager` enfileirou e liberou entrega concorrente no mesmo símbolo.

---

## 4. Catálogo Priorizado de Bugs, Fricções e Lacunas

### P1 — Bugs Funcionais Reais Descobertos em Campo
1. **Vazamento de *Thinking* no STT Gemini ([voice-client.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/voice-client.ts#L385-L395)):**
   - *Evidência:* `gemini-2.5-flash` retorna blocos com `thought: true` no array `parts` e `voice-client.ts` concatena todos os `p.text` sem filtrar `!p.thought` nem configurar `thinkingConfig: { thinkingBudget: 0 }`.
   - *Impacto:* o texto ditado pelo usuário no celular chega poluído com raciocínio interno em inglês (`think\nThe user wants...`).
2. **Falha do Opengrep em Container / Ambiente Restrito ([adapters.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/security-engine/src/adapters.ts#L324-L329)):**
   - *Evidência:* `buildArgs` invoca `["scan", "--json", "--quiet", "--", targetPath]` sem `--config` local; no `uzina-studio:verify` o `opengrep 2.0.0` tenta baixar `https://semgrep.dev/c/p/default` e aborta com `EXIT=2` (`Failure: resolution failed: unknown scheme`).
   - *Impacto:* análise SAST externa `opengrep_semgrep` retorna `failed` silencioso e deixa de pegar SQLi/eval.
3. **Digest SHA-256 Inválido em `DEFAULT_DOCKER_WORKSPACE_IMAGE` ([docker-workspace.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/opencode-bridge/src/docker-workspace.ts#L19-L20)):**
   - *Evidência:* `docker pull node:22-slim@sha256:9f241c1b86d255e7f4a4f38d58732a4752e9c40d23c1a2e2f6a203e7b1c5d6e8` falha com `not found` no Docker Hub.
   - *Impacto:* sem override manual de `UZINA_DOCKER_IMAGE`, o modo Docker cai no fallback `fallback_to_worktree`.
4. **Botão QMD na UI Omite `projectId` ([memories-manager.tsx](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/src/components/memories-manager.tsx#L228-L235)):**
   - *Evidência:* `qmdReindexMutation` envia `{ includeDocs: true, force: false }` sem `projectId`; com a trava multi-tenant (`allowDirectRootDocs: false`), arquivos `.md` do repositório Brownfield não são indexados ao clicar no botão da interface.

### P2 — Polimentos de UI/UX e Operação
5. **Two-Accent em `/app/studio` e `/app/settings`:** reduzir uso de `bg-accent` secundário para aderir 100% à regra de `<= 1` CTA primário por tela.
6. **Botões `Atualizar` duplicados em `/app/finops`:** unificar a atualização entre o resumo geral e *Efetividade Agêntica*.
7. **Sidebar Hydration Flicker:** evitar desabilitar os links de *PROJETO ATIVO* com `"Sincronizando..."` quando `projectId` já veio via query/store.
8. **Ergonomia Mobile `390px`:** compactar controles da topbar no `< 480px` (evitando truncamento do breadcrumb) e melhorar altura inicial do `MobileBottomSheet`.
9. **Ambiente Windows + WSL2:** documentar que o WSL2 hiberna após ~8s sem sessão ativa e que o `uzina-postgres-dev` deve ser acessado pelo IP da interface WSL2 quando o app roda no host Windows.

### Lacunas Estratégicas de Produto & Infraestrutura
10. **Superfície Executiva `/exec` Inexistente ([page.tsx](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/apps/web/src/app/exec/page.tsx)):** redireciona para `/app`, expondo executivos a jargão de engenharia.
11. **TTS Gemini em `fallback_browser_speech` ([voice-client.ts](file:///c:/Users/gamam/OneDrive/Documentos/_Fabrica_softwares/packages/mastra-runtime/src/voice-client.ts#L444-L452)):** hoje depende da voz sintética local do navegador quando o Cofre usa apenas Google Gemini.
12. **Trivy DB Offline no `Dockerfile`:** `trivy` precisa baixar `138.69 MiB` na primeira execução; em VPS isolada (`--network none`), deve vir pré-aquecido ou com volume persistente.

---

## 5. Proposta de Roadmap Recomendado (Slices 39–42)

| Slice Sugerido | Objetivo Principal | Escopo Técnico Resumido | Prioridade |
| :--- | :--- | :--- | :---: |
| **Slice 39 — Estabilização Pós-Auditoria (4 P1s + Polimento P2)** | Zerar os 4 bugs P1 encontrados em campo + refino visual | (1) Filtrar `part.thought` + `thinkingBudget: 0` no STT Gemini (`voice-client.ts`); (2) Embutir bundle de regras locais YAML para `opengrep` (`--config`) no `@uzina/security-engine` e `Dockerfile`; (3) Atualizar `DEFAULT_DOCKER_WORKSPACE_IMAGE` para digest real verificado (`sha256:be979e55...`); (4) Enviar `activeProjectId` no botão QMD de `memories-manager.tsx`; (5) Polimentos P2 de `90/10`, breadcrumb `390px` e FinOps `Atualizar`. | **Alta (Imediata)** |
| **Slice 40 — Superfície Executiva `/exec` Real** | Entregar experiência dedicada para Fundadores/Stakeholders | Implementar `/exec` e `/exec/deliverables` com layout calmo `max-w-[1040px]`, PRD vivo, linha do tempo de entregas, aprovações de negócio e links de preview — com barreira rígida ocultando worktrees, diffs Git, SARIF bruto e custos de tokens. | **Média-Alta** |
| **Slice 41 — Voz Neural Gemini TTS & Trivy Air-Gapped** | Paridade de voz neural e SAST offline completo | Suporte a áudio TTS nativo via Gemini / Kokoro fallback sem depender de `speechSynthesis` robotizado no iOS/Android + cache/pre-seed opcional do `trivy-db` em volume Docker. | **Média** |
| **Slice 42 — Orquestração Containerizada & Runner Sidecar** | Habilitar `DockerExecutionWorkspace` a partir do próprio container `uzina` | Proxy Docker socket restrito (Tecnativa `docker-socket-proxy` com allowlist mínima de containers) no `docker-compose.vps.yml` + instalação opcional do OpenCode CLI na imagem runner. | **Planejada** |
