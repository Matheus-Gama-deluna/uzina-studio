# Dossiê Técnico — Slices 39–42: Estabilização Pós-Auditoria, Superfície Executiva `/exec`, Voz Neural Gemini TTS & Sandbox Containerizado

**Status:** Implementado e Verificado  
**Branch:** `feat/slices-39-42-post-audit-evolution`  
**Base de Origem:** `docs/auditorias/relatorio-simulacao-ui-ux-funcionamento-v1.md` (Simulação Integral UI/UX & Funcionamento)

---

## 1. Resumo Executivo por Slice

| Slice | Escopo Entregue | Arquivos Principais |
| :---: | :--- | :--- |
| **Slice 39** | Correção dos 4 bugs P1 em campo + polimentos P2 UI/UX (`90/10`, FinOps único `Atualizar`, breadcrumb mobile `390px`) | `packages/mastra-runtime/src/voice-client.ts`, `packages/security-engine/rules/uzina-sast-core.yaml`, `packages/security-engine/src/adapters.ts`, `Dockerfile`, `packages/opencode-bridge/src/docker-workspace.ts`, `apps/web/src/components/memories-manager.tsx`, `finops-dashboard.tsx`, `agent-effectiveness-panel.tsx`, `mobile-settings-panel.tsx`, `cockpit-shell.tsx`, `scripts/qa-sim/visual-audit-probe.mjs` |
| **Slice 40** | Superfície Executiva `/exec` real para fundadores/stakeholders com **Barreira de Domínio** estrita (zero vazamento de `worktreePath`, `branchName`, `SARIF`, `blueprintJson` ou tokens) | `packages/contracts/src/executive.ts`, `apps/web/src/app/api/exec/overview/route.ts`, `apps/web/src/components/executive-cockpit.tsx`, `apps/web/src/app/exec/page.tsx`, `apps/web/src/components/command-palette.tsx`, `apps/web/src/components/cockpit-shell.tsx` |
| **Slice 41** | Síntese de Voz Neural Google Gemini (`gemini-2.5-flash-preview-tts` + `wrapPcm16MonoToWav`) + Cache persistente / modo offline do Trivy (`--cache-dir`, `--skip-db-update`, `--offline-scan`) | `packages/mastra-runtime/src/voice-client.ts`, `packages/security-engine/src/adapters.ts`, `Dockerfile` |
| **Slice 42** | Sidecar `docker-socket-proxy` opcional (`profiles: ["sandbox"]`), allowlist `validateDockerHostEndpoint` e detecção automática de Docker via WSL2 em `uzina doctor` | `packages/opencode-bridge/src/docker-workspace.ts`, `docker-compose.vps.yml`, `apps/cli/src/cli.ts` |

---

## 2. Detalhamento Técnico

### Slice 39 — Estabilização P1 & Refino P2
1. **Gemini STT sem vazamento de `thought`:** `transcribeAudioWithVault` agora envia `generationConfig.thinkingConfig = { thinkingBudget: 0 }` e filtra quaisquer blocos com `part.thought === true`, eliminando raciocínio interno da transcrição final.
2. **Opengrep offline self-contained:** Adicionado bundle local `packages/security-engine/rules/uzina-sast-core.yaml` (`eval-execution`, `sql-concat`, `subprocess-shell-true`, `dangerously-set-inner-html`), copiado para a imagem final no `Dockerfile`, e passagem obrigatória de `--no-git-ignore --config <bundle>` em `opengrep_semgrep.buildArgs` (com `/*turbopackIgnore: true*/` eliminando warnings do Turbopack).
3. **Digest SHA-256 real em `DEFAULT_DOCKER_WORKSPACE_IMAGE`:** Atualizado para `node:22-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb`.
4. **Botão QMD na UI com escopo de projeto:** `memories-manager.tsx` utiliza `useActiveProjectId()`, enviando `projectId` em `qmdReindexMutation` e `qmdSearchMutation`.
5. **Polimento P2 (`90/10` e ergonomia mobile):** `finops-dashboard.tsx` e `agent-effectiveness-panel.tsx` consolidam atualização em um único `finops-refresh-btn`; `mobile-settings-panel.tsx` reduz `btn-enable-web-push` para estilo sutil (`border-accent/50 bg-accent-subtle text-accent`); `cockpit-shell.tsx` adiciona `staleTime: 30_000`, evita `"Sincronizando..."` quando `currentProject` já está carregado e oculta controles secundários no `< 640px`.

### Slice 40 — Superfície Executiva `/exec`
* Contrato estrito `ExecutiveProjectOverviewSchema` (`.strict()`) em `@uzina/contracts`.
* Rota `GET /api/exec/overview` com RBAC (`READ_ROLES`), isolamento multi-tenant (`organizationId`) e projeção de colunas exclusivamente de negócio (`deliverables.status` mapeado para 8 `ExecutiveStage`, PRD vivo `prd_vision`, preview `<iframe sandbox="">` e aprovações com `spokenSummary`).
* Interface `ExecutiveCockpit` com largura máxima `1040px`, alternância de produto, 5 estados de UI (`loading`, `empty`, `error`, `populated`, `disabled`), player de áudio e aprovação por um toque (`POST /api/decisions/:id/resolve`).

### Slice 41 — Voz Neural Gemini TTS & Trivy Air-Gapped
* `wrapPcm16MonoToWav(pcmBuffer, 24000)` constrói cabeçalho RIFF/WAVE de 44 bytes (PCM 16-bit mono little-endian).
* `synthesizeSpeechWithVault` passa a suportar `providerType === "google"` usando `models/gemini-2.5-flash-preview-tts:generateContent` autenticado via header `x-goog-api-key` (nunca em querystring), com fallback gracioso para `fallback_browser_speech` em caso de HTTP error ou resposta vazia.
* `buildTrivyFsArgs(targetPath, env)` injeta `--cache-dir <UZINA_DATA_DIR>/trivy-cache`, `--skip-db-update` (quando `trivy.db` já está cacheado ou offline) e `--offline-scan` (quando `UZINA_TRIVY_OFFLINE=1`), preservando `"--"` antes de `targetPath`; `Dockerfile` cria `/data/trivy-cache`.

### Slice 42 — Sidecar `docker-socket-proxy` & `uzina doctor` WSL2
* `validateDockerHostEndpoint(rawHost)` valida estritamente `DOCKER_HOST`, aceitando apenas socket padrão local, `unix:///...`, `npipe:////./pipe/...` ou `tcp://` restrito a loopback (`127.0.0.1`, `localhost`, `[::1]`) e sidecars internos (`docker-proxy`, `uzina-docker-proxy`) com porta explícita; endpoints externos ou protocolos inseguros são bloqueados antes do `execFile` em `defaultDockerRunner`.
* `docker-compose.vps.yml` adiciona o serviço opcional `docker-proxy` (`tecnativa/docker-socket-proxy:0.3`, `profiles: ["sandbox"]`, `read_only: true`, `cap_drop: [ALL]`, rede interna `uzina_sandbox_ctl` e allowlist mínima).
* `apps/cli/src/cli.ts` detecta automaticamente `wsl -e docker --version` no comando `uzina doctor` em hosts Windows sem Docker nativo, expondo `wslAvailable`, `wslVersion` e dica acionável no JSON e no resumo textual.

---

## 3. Evidências de Verificação (Arquivos de Teste Dedicados)
* `apps/web/tests/slice39-post-audit-stabilization.test.ts` (2/2)
* `packages/opencode-bridge/tests/slice39-docker-image-digest.test.ts` (1/1)
* `apps/web/tests/slice40-executive-surface.test.ts` (4/4) e `apps/web/e2e/slice40-executive-surface.spec.ts`
* `apps/web/tests/slice41-gemini-tts-trivy-offline.test.ts` (6/6)
* `packages/opencode-bridge/tests/slice42-docker-host-proxy.test.ts` (11/11)
* `apps/cli/tests/slice42-doctor-wsl2.test.ts` (2/2)
