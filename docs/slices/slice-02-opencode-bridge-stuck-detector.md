# Dossiê do Slice 2 — OpenCode Bridge, Git Worktrees, 8 Skills & `StuckDetector` (Uzina Studio)

* **Status:** `Concluído (Verify Gate + AppSec + Test Critic + EGM Codebase Details + Factory Verifier PASS)`
* **Branch:** `feat/slice-02-opencode-bridge-stuck-detector` (base: `feat/slice-01-hierarchy-vault-ui`)
* **Estratégia Aplicada:** *Domain-First + Contract-First + Tests as Data*
* **Spec de Referência:** `docs/especificacao-tecnica-fase-1-v1.1.md` (Seções 3, 6.1, 6.3, 8 e 9) · `docs/especificacao-produto-arquitetura-v2.10.md` (Seções 5.1, 5.5, 5.9, 5.11) · `docs/adr/001-identidade-uzina-studio.md`

---

## 1. Objetivo e Escopo Estrito

Entregar a ponte segura e isolada de execução de agentes codificadores e o detector determinístico de loops/bloqueios do **Uzina Studio**:
* **Contratos Compartilhados (`@uzina/contracts`):** Schemas Zod v4 e tipos inferidos para worktrees (`ExecutionWorkspace`), execução de comandos, skills nativas, configuração interna server-side de provedor, observações de turno, os 5 alertas do `StuckDetector` e entrada/saída de sessão OpenCode.
* **Núcleo de Domínio (`@uzina/core`):**
  * `redact.ts` (zero `node:*`): `redactSecrets(value, secrets)` com sanitização recursiva em strings, objetos, arrays e objetos `Error` (`message` + `stack`).
  * `path-guard.ts`: contenção estrita de path traversal (rejeição de `\0`, caminhos UNC, drive-relative no Windows, remoção de prefixo `\\?\` do `realpathSync.native`, bloqueio de nomes reservados Windows, prefix trap, case-insensitivity Windows, resolução opcional via `allowRoot`, escape via symlinks/junctions), `sanitizeWorktreeSlug(input, uniqueSuffix?)` e `assertSafeGitRef(ref, label)`.
  * `stuck-detector.ts` (**estritamente zero imports `node:*`**, exportado também em `@uzina/core/stuck-detector` para uso browser-safe nos Slices 3–5): detector determinístico puro implementando os **5 padrões do OpenHands StuckDetector** (Spec §6.3).
  * `skills-loader.ts`: parser e carregador validado com Zod das **8 skills nativas** reais em `packages/skills/*/SKILL.md` com suporte a LF/CRLF, `UZINA_SKILLS_DIR`, filtragem em interseção (`roles` ∧ `names`) e formatação determinística para Prompt Cache.
* **Bridge OpenCode & Git Worktrees (`@uzina/opencode-bridge`):**
  * Fronteira estrita: importa **apenas** `@uzina/contracts` e `@uzina/core` (nunca `@uzina/db` ou `@mastra/*`).
  * `LocalGitWorktreeWorkspace`: implementação Fase 1 da interface `ExecutionWorkspace` usando Git worktrees reais (`git worktree add -b uzina/<slug>-<hash> <dir> <baseBranch>`), execução sem shell (`shell: false`), `env` filtrado por allowlist estrita, bloqueio de shells e comandos destrutivos, kill completo da árvore de processos, captura de diff unificado (incluindo *untracked* via `GIT_INDEX_FILE` temporário + truncamento por `maxBytes`) e limpeza idempotente (apenas branches `uzina/*`, com retry curto no Windows).
  * `OpenCodeTransport` + `SdkOpenCodeTransport` (usando `@opencode-ai/sdk@1.19.6`, separando `serverUrl` do servidor OpenCode de `providerConfig.baseUrl` do provedor LLM, com assinatura SSE `/event` em tempo real) + `InMemoryOpenCodeTransport` (`@uzina/opencode-bridge/testing`).
  * `OpenCodeRunner`: orquestrador de sessão que impõe Prompt Cache Hygiene (modelo fixo por papel via `resolveLockedModelTarget` e prefixo `system` estático), isolamento preventivo e pós-turno do modo `plan` (allowlist fail-closed + checagem Git `status --porcelain` no worktree), descriptografia efêmera AES-256-GCM apenas em memória com isolamento XDG e redação de segredos, `StuckDetector` em tempo real, `maxSteps`, `AbortSignal` / `timeoutMs` e validação opcional de `StructuredOutput` via Zod (`z.toJSONSchema()`).

### Explicitamente Fora de Escopo (Slices Futuros)
* Orquestração Mastra Core (`@uzina/mastra-runtime`), `deliverableLifecycleWorkflow`, `LibSQLStore`/`PostgresStore`, lock atômico SQL e Estúdio Visual Lite (`Slice 3`).
* Auditor estático de testes (`test-auditor.ts`), `@uzina/security-engine` (Gitleaks/Opengrep/Trivy/OSV/SARIF) e Caixa de Decisões HITL (`Slice 4`).
* Co-piloto Executivo (`.network()`) e CRUD de `memories` (`Slice 5`).
* `apps/web` (nenhuma tela ou rota HTTP alterada neste Slice) e `apps/cli` / Docker (`Slice 6`).

---

## 2. Fronteiras de Pacotes, Dependências Pinadas e Arquivos Previstos

* **`@uzina/contracts` (`packages/contracts` — ZERO dependências internas):**
  * Criar `src/execution.ts`
  * Editar `src/index.ts` (re-exportar `./execution.js`)
  * Criar `tests/slice2-contracts.test.ts`
* **`@uzina/core` (`packages/core` — importa APENAS `@uzina/contracts`):**
  * Criar `src/redact.ts`, `src/path-guard.ts`, `src/stuck-detector.ts`, `src/skills-loader.ts`
  * Editar `src/index.ts` e `package.json` (adicionar export browser-safe `"./stuck-detector": { "types": "./dist/stuck-detector.d.ts", "import": "./dist/stuck-detector.js" }`)
  * Criar `tests/path-guard.test.ts`, `tests/stuck-detector.test.ts`, `tests/skills-loader.test.ts`
* **`@uzina/opencode-bridge` (`packages/opencode-bridge` — importa APENAS `@uzina/contracts` e `@uzina/core`):**
  * `package.json`: `"name": "@uzina/opencode-bridge"`, `"type": "module"`, `"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }, "./testing": { "types": "./dist/testing.d.ts", "import": "./dist/testing.js" } }`, scripts `build`, `typecheck`, `lint`, `test` idênticos aos demais pacotes.
  * Dependências pinadas (`save-exact=true`): `@opencode-ai/sdk@1.19.6` (MIT), `@uzina/contracts@workspace:*`, `@uzina/core@workspace:*`, `zod@4.6.7`; DevDeps: `@types/node@26.6.6`, `typescript@5.9.3`, `vitest@5.1.1`.
  * `tsconfig.json` (`extends: "../../tsconfig.base.json"`, `rootDir: "src"`, `outDir: "dist"`), `vitest.config.ts` (`testTimeout: 20000`).
  * Código-fonte: `src/errors.ts`, `src/workspace.ts`, `src/transport.ts`, `src/runner.ts`, `src/testing.ts`, `src/index.ts`.
  * Testes: `tests/worktree.integration.test.ts`, `tests/sdk-transport.test.ts`, `tests/runner.test.ts`.

---

## 3. Contratos Compartilhados (`@uzina/contracts/src/execution.ts`)

* **Enums e Padrões:**
  * `OpenCodeModeSchema = z.enum(["plan", "build"])`
  * `StuckPatternSchema = z.enum(["repeated_action_observation", "repeated_action_error", "monologue_no_tool", "alternating_ping_pong", "context_window_overflow"])`
  * `OpenCodeSessionStatusSchema = z.enum(["completed", "stuck", "aborted", "timed_out", "error"])`
* **Observações e Alertas do `StuckDetector`:**
  * `AgentTurnObservationSchema`:
    * `turnIndex: z.number().int().nonnegative()`
    * `actionType: z.enum(["tool_call", "assistant_text", "error"])`
    * `toolName: z.string().trim().min(1).optional()`
    * `actionSignature: z.string().trim().min(1).optional()`
    * `observationSignature: z.string().trim().min(1).optional()`
    * `errorMessage: z.string().trim().min(1).optional()`
    * `isContextOverflow: z.boolean().default(false)`
    * Refinamento `.superRefine`: quando `actionType === "tool_call"`, `toolName` é obrigatório; quando `actionType === "error"`, exige `errorMessage` ou `isContextOverflow === true`.
  * `StuckAlertSchema`:
    * `detected: z.literal(true)`, `pattern: StuckPatternSchema`, `decisionType: z.literal("stuck_intervention")`, `reason: z.string().min(1)`, `evidenceTurns: z.array(z.number().int().nonnegative()).min(1)`
* **Workspace & Comandos:**
  * `WorktreePrepareInputSchema`: `repoPath`, `baseBranch`, `deliverableId`, `worktreesRootDir?`
  * `WorktreeHandleSchema`: `deliverableId`, `repoPath`, `workspacePath`, `branchName`, `baseBranch`
  * `ExecOptionsSchema`: `cwd?`, `timeoutMs: z.number().int().min(100).max(600_000).default(60_000)`, `env?: z.record(z.string(), z.string())`, `maxOutputBytes: z.number().int().min(1024).max(10_485_760).default(1_048_576)`
  * `ExecResultSchema`: `exitCode: z.number().int().nullable()`, `stdout: z.string()`, `stderr: z.string()`, `durationMs: z.number().nonnegative()`, `timedOut: z.boolean()`, `aborted: z.boolean()`, `truncated: z.boolean()`
* **Skills & Sessão OpenCode:**
  * `SkillDefinitionSchema`: `name: z.string().regex(/^[a-z0-9-]+$/)`, `description: z.string().trim().min(1)`, `appliesToRoles: z.array(AgentRoleSchema).min(1)`, `content: z.string().trim().min(1)`, `filePath: z.string().min(1)`
  * `OpenCodeProviderConfigSchema` *(uso exclusivo server-side — jamais retornar em endpoints HTTP/MSW)*:
    * `providerType: ProviderTypeSchema`, `baseUrl: HttpUrlSchema.nullable().optional()`, `encryptedApiKey: z.string().min(1).nullable().optional()`, `organizationId: z.uuid()`, `roleBindings: RoleBindingsSchema`
  * `TokenUsageSchema`: `inputTokens: z.number().int().nonnegative().default(0)`, `outputTokens: z.number().int().nonnegative().default(0)`, `cacheReadTokens: z.number().int().nonnegative().default(0)`
  * `OpenCodeRunSessionOptionsSchema`: `workspacePath`, `mode: OpenCodeModeSchema`, `role: AgentRoleSchema`, `providerConfig: OpenCodeProviderConfigSchema`, `prompt: z.string().trim().min(1)`, `systemPromptPrefix?`, `skillNames?`, `skillsDir?`, `maxSteps: z.number().int().min(1).max(200).default(24)`, `timeoutMs: z.number().int().min(1000).max(3_600_000).default(300_000)`
  * `OpenCodeSessionResultSchema`:
    * `sessionId: z.string().nullable()`
    * `status: OpenCodeSessionStatusSchema`
    * `mode: OpenCodeModeSchema`
    * `role: AgentRoleSchema`
    * `lockedModelId: z.string().min(1)`
    * `finalText: z.string()`
    * `structuredOutput: z.unknown().optional()`
    * `stuckAlert: StuckAlertSchema.nullable()`
    * `touchedFiles: z.array(z.string())`
    * `commandsExecuted: z.array(z.string())`
    * `tokenUsage: TokenUsageSchema`
    * `turns: z.number().int().nonnegative()`
    * `durationMs: z.number().nonnegative()`
    * `errorMessage: z.string().optional()`

---

## 4. Domínio, Segurança e Decisões Técnicas

### 4.1 Redação de Segredos (`packages/core/src/redact.ts`)
* Zero imports `node:*`.
* `redactSecrets(text: string, secrets: readonly (string | null | undefined)[]): string`: ignora segredos vazios ou com comprimento `< 4` caracteres; substitui todas as ocorrências por `"[REDACTED]"`.
* `redactSecretsInValue<T>(value: T, secrets): T` e `redactError(error, secrets): Error` (sanitiza `message` e `stack` sem perder o `name`/`code` original).

### 4.2 Path Guard & Git Safety (`packages/core/src/path-guard.ts`)
* `WorkspaceBoundaryError extends Error` (`code = "PATH_OUTSIDE_WORKSPACE"`).
* `assertPathInsideWorkspace(workspaceRoot, targetPath, options?: { followSymlinks?: boolean; allowRoot?: boolean }): string`:
  * Rejeita vazio ou `\0`.
  * Rejeita caminhos UNC (`\\server\share`) e drive-relative Windows (`C:foo` sem separador após `:`).
  * Bloqueia segmentos com nomes reservados Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`, com ou sem extensão).
  * Resolve `targetPath` relativo usando `path.resolve(workspaceRoot, targetPath)`.
  * Quando `followSymlinks !== false`, resolve `fs.realpathSync.native` (removendo eventual prefixo `\\?\` no Windows) do root e do ancestral mais próximo existente de `targetPath`, concatenando o sufixo ainda não criado para bloquear escapes via symlink ou directory junction.
  * Em `win32`, compara caminhos em lowercase antes de `path.relative`.
  * Rejeita se `rel.startsWith("..") || path.isAbsolute(rel)` ou se `rel === ""` quando `!options?.allowRoot` (default `allowRoot = false` para arquivos; `cwd` passa `{ allowRoot: true }`).
* `sanitizeWorktreeSlug(input: string, uniqueSuffix?: string): string`: retorna apenas `<slug>` puro `[a-z0-9-]`, max 48 chars (com sufixo determinístico curto quando `uniqueSuffix` fornecido), fallback `"task"` se entrada vazia após normalização.
* `assertSafeGitRef(ref: string, label?: string): string`: bloqueia string vazia, prefixo `-`, `..`, whitespace, chars de controle (`0x00–0x1f`, `0x7f`), `~`, `^`, `:`, `?`, `*`, `[`, `\`, `@{`, `//`, `.lock` final, segmento iniciando com `.`, `@` isolado, e `/` inicial/final.

### 4.3 `StuckDetector` Determinístico (`packages/core/src/stuck-detector.ts`)
* **Zero imports `node:*`:** importa apenas `@uzina/contracts`.
* `StuckDetectorConfig`: `{ contextOverflowThreshold: 2, actionErrorThreshold: 3, actionObservationThreshold: 4, pingPongThreshold: 6, monologueThreshold: 3 }` (todos positivos).
* `CONTEXT_OVERFLOW_REGEX = /context.?length|maximum context|max.?tokens|token.?limit|context.?window|prompt is too long|exceeds.*context|too many tokens/i`.
* Precedência determinística (`detectStuck(history, config?)`):
  1. `context_window_overflow`: últimos `contextOverflowThreshold` turnos satisfazem `isContextOverflow || (errorMessage && CONTEXT_OVERFLOW_REGEX.test(errorMessage))`.
  2. `repeated_action_error`: últimos `actionErrorThreshold` turnos possuem erro (`actionType === "error" || Boolean(errorMessage)`) **e** possuem assinatura de ação não vazia `(actionSignature ?? toolName)` idêntica (turnos sem assinatura nunca são agrupados como "mesma ação").
  3. `repeated_action_observation`: últimos `actionObservationThreshold` turnos têm `actionType === "tool_call"`, `actionSignature` não vazio, e chave `(toolName, actionSignature, observationSignature ?? "")` idêntica.
  4. `alternating_ping_pong`: últimos `pingPongThreshold` (6) turnos são `tool_call` com `actionSignature` não vazio formando exatamente `A, B, A, B, A, B` com `sig(A) !== sig(B)`.
  5. `monologue_no_tool`: últimos `monologueThreshold` (3) turnos consecutivos têm `actionType === "assistant_text"`.
* Classe `StuckDetector`: `recordTurn(obs: AgentTurnObservation): StuckAlert | null`, `getHistory(): readonly AgentTurnObservation[]`, `reset(): void`.

### 4.4 Carregador das 8 Skills (`packages/core/src/skills-loader.ts`)
* `parseSkillMarkdown(rawMarkdown, filePath)`: aceita `\r\n`/`\n`, extrai YAML frontmatter (`name`, `description`, `applies_to_roles`), suporta valores com `:` e aspas e listas inline `[a, b]` ou multilinha `- a`. Lança erro explícito se detectar sintaxe YAML escalar não suportada (`>-`, `|`) ou validação Zod falhar contra `SkillDefinitionSchema`.
* `resolveDefaultSkillsDir()`: checa `process.env.UZINA_SKILLS_DIR`, depois percorre pais de `import.meta.url` e `process.cwd()` buscando `packages/skills`.
* `loadNativeSkills(options?: { skillsDir?: string; roles?: AgentRole[]; names?: string[] })`: ordena alfabeticamente por `name`; se `names` fornecido, valida existência de **todos** os nomes antes de filtrar; se `roles` e `names` estiverem ambos presentes, aplica **interseção (`AND`)**.
* `formatSkillsForPrompt(skills)`: retorna `""` quando vazio; para `skills.length > 0`, formata deterministicamente em ordem de `name` dentro de `<native_skills>` para preservar o prefixo de Prompt Cache.

### 4.5 `ExecutionWorkspace` & `LocalGitWorktreeWorkspace` (`packages/opencode-bridge/src/workspace.ts`)
* **Assinatura Pública (`ExecutionWorkspace`):**
  * `prepare(repoPath: string, baseBranch: string, deliverableId: string, options?: { worktreesRootDir?: string }): Promise<WorktreeHandle>`
  * `exec(command: string, args?: string[], options?: ExecOptions & { signal?: AbortSignal }): Promise<ExecResult>`
  * `getDiff(baseRef?: string, options?: { maxBytes?: number; includeUntracked?: boolean }): Promise<string>`
  * `cleanup(options?: { deleteBranch?: boolean }): Promise<void>`
* **Sanitização & Bloqueio:**
  * Zero `shell: true` em todos os `spawn`.
  * `sanitizeChildEnv(baseEnv, extraEnv)`: **allowlist estrita** para variáveis herdadas de `baseEnv` (`PATH`, `PATHEXT`, `HOME`, `USERPROFILE`, `SYSTEMROOT`, `COMSPEC`, `TEMP`, `TMP`, `TMPDIR`, `LANG`, `LC_ALL`, `NODE_ENV`, `CI`, comparação case-insensitive) e bloqueio explícito em `extraEnv` para `MASTER_ENCRYPTION_KEY`, `VAULT_MASTER_KEY`, `BETTER_AUTH_SECRET`, `DATABASE_URL`, `*_API_KEY`, `*_SECRET`, `*_TOKEN`, `PASSWORD`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_ASKPASS`, `NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, `AWS_ACCESS_KEY_ID`, `SSH_AUTH_SOCK`. Sempre define `GIT_TERMINAL_PROMPT: "0"`.
  * `assertSafeCommand(command, args)`: normaliza executável (basename sem `.exe`/`.cmd`/`.bat`), bloqueia interpretadores de shell (`sh`, `bash`, `zsh`, `cmd`, `powershell`, `pwsh`), executáveis destrutivos (`format`, `mkfs`, `dd`, `shutdown`, `reboot`, `diskpart`), e flags destrutivas (`rm` com `-r`/`-f` fora de caminhos seguros ou mirando `/`, `git push --force`/`-f`/`-uf`, `git reset --hard`) com `DangerousCommandError`.
  * Kill completo de árvore de processos em timeout/`AbortSignal` (`taskkill /pid <pid> /T /F` no Windows; `detached: true` + `process.kill(-pid, "SIGKILL")` no POSIX), além de `signal?.throwIfAborted()` pré-execução.
* **Worktrees & Diff:**
  * `prepare()` usa slug único `task-<slug>-<hash8>` e branch `uzina/<slug>-<hash8>`, adiciona `.worktrees/` em `<gitCommonDir>/info/exclude` quando dentro de `repoPath` (para não sujar `git status --porcelain`), realiza rollback se `git worktree add` falhar após etapa parcial.
  * `getDiff(baseRef?, options?)` passa `--` antes do ref, captura também arquivos *untracked* (padrão `includeUntracked: true`) usando um `GIT_INDEX_FILE` temporário (`git add -N -- .` nesse índice isolado) removido em `finally`, e aplica truncamento seguro por `maxBytes`.
  * `cleanup({ deleteBranch })`: idempotente, remove listeners/worktree com `git worktree remove --force` + `git worktree prune` + retry curto no Windows (`EBUSY`/`EPERM`), e só executa `git branch -D -- <branch>` quando `branch.startsWith("uzina/")`.

### 4.6 `SdkOpenCodeTransport`, `OpenCodeRunner` & Cofre AES-256-GCM
* **Hierarquia de Erros (`src/errors.ts`):** `OpenCodeBridgeError` (base com `code: string`) e subclasses: `MissingRoleBindingError`, `MissingProviderApiKeyError`, `VaultDecryptionError`, `PromptCacheModelSwitchError`, `PlanModeWriteViolationError`, `DangerousCommandError`, `StructuredOutputValidationError`, `WorktreeError`, `OpenCodeTransportError`.
* **Mapeamento Canônico de Modelo (`resolveLockedModelTarget(providerConfig, role)`):**
  * Exige `providerConfig.roleBindings[role]?.modelId` (`MissingRoleBindingError`).
  * Se contiver `"/"`, usa o primeiro segmento como `providerID` e o restante como `modelID`; caso contrário, `providerID = providerConfig.providerType` e `modelID = binding.modelId`. Retorna `{ providerID, modelID, canonicalId: "${providerID}/${modelID}" }`.
* **Interface `OpenCodeTransport` (`src/transport.ts`):**
  * `createSession(input: TransportCreateSessionInput): Promise<TransportSessionHandle>`
  * `TransportSessionHandle.run(input: TransportRunInput): Promise<TransportRunOutput>` — recebe callback em tempo real `onTurn(event)` disparado para cada step/tool (vindo do stream SSE `/event` no SDK real ou passo a passo no `InMemoryOpenCodeTransport`) permitindo aborto imediato via `handle.abort()`.
  * `SdkOpenCodeTransportOptions` separa estritamente `serverMode: "embedded" | "remote"`, `serverUrl?` e `serverHeaders?` (endereço do servidor OpenCode) de `providerConfig.baseUrl` (endpoint do provedor LLM OmniRoute/OpenAI-compatible/Ollama).
  * No modo `"embedded"`, `SdkOpenCodeTransport` cria diretórios XDG efêmeros (`XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`) por sessão removidos em `finally` — **impedindo gravação de segredos em `~/.local/share/opencode/auth.json`**. Injeta `config.provider[providerID]` com `options.apiKey` e `options.baseURL` somente em memória na inicialização e assina `client.event.subscribe({ query: { directory } })` em paralelo com `client.session.prompt(...)`.
  * Quando `outputSchema` presente, converte via `z.toJSONSchema(outputSchema)` do Zod v4 para `format: { type: "json_schema", schema }`.
* **Isolamento `plan` em 3 Camadas (`OpenCodeRunner`):**
  1. Política preventiva de permissões na sessão OpenCode negando edição e shell em `mode === "plan"`;
  2. **Allowlist *fail-closed*** de ferramentas somente-leitura (`read`, `glob`, `grep`, `list`, `ls`, `find`, `search`, `view`) durante o stream `onTurn`; qualquer outra ferramenta ou `touchedFiles.length > 0` aborta imediatamente com `PlanModeWriteViolationError`;
  3. Snapshot `git status --porcelain` antes e depois da sessão quando `workspacePath` for repositório/worktree Git: qualquer diferença aciona `PlanModeWriteViolationError`.
* **Matriz *Exceção vs `OpenCodeSessionResult` (`runner.runSession`)***:
  * **Lança exceção (com `redactError`):** `MissingRoleBindingError`, `MissingProviderApiKeyError`, `VaultDecryptionError`, `PromptCacheModelSwitchError`, `PlanModeWriteViolationError`, `WorkspaceBoundaryError`, `StructuredOutputValidationError`, `OpenCodeTransportError`.
  * **Retorna `OpenCodeSessionResult`:** `status: "completed"` | `"stuck"` (com `stuckAlert` + `abort()` chamado) | `"aborted"` (`AbortSignal` externo) | `"timed_out"` (`timeoutMs` excedido).

---

## 5. Plano de Testes (*Spec → Teste* antes do Build)

* **Contratos (`packages/contracts/tests/slice2-contracts.test.ts`):** `test.each` cobrindo schemas válidos/inválidos (`evidenceTurns` vazio, `timeoutMs < 100`, `actionType: "tool_call"` sem `toolName`, `name` inválido, `baseUrl` `javascript:`, `appliesToRoles` vazio).
* **Domínio (`packages/core/tests/`):**
  * `path-guard.test.ts` (`test.each`): caminhos válidos, `../`, prefix trap, `\0`, UNC, nomes reservados Windows, drive-letter casing, junction/symlink escape real em `os.tmpdir()`, e `assertSafeGitRef` (incluindo `.lock`, `//`, `@`, chars de controle).
  * `stuck-detector.test.ts` (*Tests as Data* via `test.each`): todos os **5 padrões positivos**, fronteiras `N-1`, quebra de sequência, `repeated_action_error` sem assinatura não gerando falso positivo, ping-pong com `A === B` não disparando, precedência e `reset()`.
  * `skills-loader.test.ts`: carregamento e validação Zod das **8 skills reais** em `packages/skills/*/SKILL.md`, LF/CRLF, interseção `roles` + `names`, erro em skill inexistente e YAML inválido/`>-`, `formatSkillsForPrompt`.
* **Integração Real Git Worktree (`packages/opencode-bridge/tests/worktree.integration.test.ts`):** repo Git real em `os.tmpdir()`, `prepare()` sem poluir `git status` do repo principal, criação/alteração na worktree mantendo repo principal limpo, `exec` portável via `process.execPath`, bloqueio de `cwd` externo, bloqueio de shells (`cmd`/`sh`), não-vazamento de `MASTER_ENCRYPTION_KEY`/`GIT_DIR`, `timeoutMs` e `AbortSignal` encerrando processo filho, `getDiff()` capturando modificações **e** arquivo novo *untracked*, e `cleanup({ deleteBranch: true })` idempotente.
* **Integração SDK OpenCode (`packages/opencode-bridge/tests/sdk-transport.test.ts`):** servidor HTTP local real (`node:http`) servindo `POST /session`, `POST /session/:id/message`, `POST /session/:id/abort` e stream SSE `GET /event`, exercitando `SdkOpenCodeTransport` (`@opencode-ai/sdk@1.19.6`) com captura de `agent`, `model`, `system`, `directory`, `format`, eventos SSE em tempo real e `abort()`.
* **Runner & Segurança (`packages/opencode-bridge/tests/runner.test.ts`):** `InMemoryOpenCodeTransport` cobrindo modelo fixo + `PromptCacheModelSwitchError`, allowlist `plan` + `git status` pós-sessão, path traversal em `touchedFiles`, descriptografia AES-256-GCM real + tamper negativo (AAD divergente) + `redactSecrets` no resultado e em erro relançado, os 5 alertas `StuckDetector` com `abort()` + `close()`, `AbortSignal` pré-abortado e durante sessão, `timeoutMs`, `maxSteps`, `outputSchema` Zod e injeção determinística de skills.

---

## 6. Critérios de Pronto (DoD)

1. `node scripts/check-no-ee.mjs` retorna `0` e `@opencode-ai/sdk@1.19.6` confirmado MIT.
2. `pnpm verify` sem cache passa com `exit 0` (0 erros/warnings ESLint).
3. Todas as 8 skills em `packages/skills/*/SKILL.md` carregam e validam contra `SkillDefinitionSchema`.
4. Todos os 5 padrões do `StuckDetector` passam via `test.each` e `@uzina/core/stuck-detector` tem zero imports `node:*`.
5. `worktree.integration.test.ts` executa Git worktree real em repo temporário com isolamento, diff de *untracked* e limpeza idempotente.
6. `sdk-transport.test.ts` exercita `@opencode-ai/sdk@1.19.6` real sobre HTTP + SSE local, e `runner.test.ts` comprova Prompt Cache, `plan` allowlist + git check, AES-256-GCM sem vazamento, `AbortSignal`, `timeoutMs` e `StructuredOutput`.
7. `test-critic`, `appsec-auditor`, `egm-codebase-details` e `factory-verifier` retornam `PASS` e artefatos de fase atualizados.

---

## 7. Revisão EGM Pré-Código (Plan Gate)

* **`egm-design` (CRITICAL/HIGH/MEDIUM resolvidos):**
  1. `[CRITICAL]` Protocolo SSE `/event` em tempo real integrado ao `SdkOpenCodeTransport` para acionar `StuckDetector` e `abort()` imediatamente antes do fim da sessão.
  2. `[CRITICAL]` Modo `plan` protegido em 3 camadas: permissão preventiva na sessão, allowlist *fail-closed* de ferramentas read-only e verificação Git `status --porcelain` pré/pós-sessão.
  3. `[CRITICAL]` Segregação entre `serverUrl` do OpenCode Server e `providerConfig.baseUrl` do LLM; diretórios XDG isolados por sessão no modo embedded (sem gravar `~/.local/share/opencode/auth.json`); `redactSecrets` recursivo incluindo stack traces.
  4. `[HIGH]` Allowlist estrita para `env` herdado + bloqueio de `GIT_DIR`/`NODE_OPTIONS`/`LD_PRELOAD`/shells + kill completo da árvore de processos (`taskkill /T /F` no Windows / `-pid` no POSIX).
  5. `[HIGH]` `getDiff()` capturando arquivos *untracked* via `GIT_INDEX_FILE` temporário sem sujar índice real, sempre com `--` e truncamento seguro.
  6. `[HIGH/MEDIUM]` `resolveLockedModelTarget` canônico + `system` estático; slug com hash único + `.git/info/exclude`; `maxSteps` + `commandsExecuted` no contrato; `@uzina/core/stuck-detector` livre de `node:*`.
* **`egm-implementation-readiness` (BLOCKERs/WARNINGs resolvidos):**
  * Travadas integralmente todas as assinaturas de `ExecutionWorkspace`, `OpenCodeTransport`, `OpenCodeRunner`, `AgentTurnObservationSchema`, `OpenCodeSessionResultSchema`, hierarquia de erros e comportamento Windows (`\\?\`, junctions, `process.execPath` em testes, drive casing).

---

## 8. Evidências Reais Pós-Código (Verify Gate)
* **Saída `node scripts/check-no-ee.mjs`:** `OK [check-no-ee]: Nenhuma dependência ou importação comercial Mastra ee/ encontrada.` (exit `0`; `@opencode-ai/sdk@1.19.6` confirmado `MIT`).
* **Saída `pnpm verify` sem cache (`build --force` + `typecheck lint test --force`):** `exit 0` (`18/18` tasks no build+verify sequencial; `20/20` tasks no `factory-verifier`), zero erros/warnings ESLint e zero warnings Turbopack no `next build`:
  * `@uzina/contracts`: **62/62** testes aprovados (`slice2-contracts.test.ts`: 24/24).
  * `@uzina/core`: **97/97** testes aprovados (`stuck-detector.test.ts`: 17/17, `path-guard.test.ts`: 36/36, `skills-loader.test.ts`: 7/7 + `state-machine`: 23/23 + `vault`: 14/14).
  * `@uzina/db`: **17/17** testes aprovados (`1 skipped` esperado `postgres-live.test.ts` com `TEST_DATABASE_URL` ausente).
  * `@uzina/opencode-bridge`: **44/44** testes aprovados (`worktree.integration.test.ts`: 21/21, `sdk-transport.test.ts`: 4/4, `runner.test.ts`: 19/19).
  * `@uzina/web`: **15/15** testes aprovados + `next build` (17 rotas).
  * **Total executado:** **235 testes aprovados**, `0` falhas.
* **Resumo `test-critic` / `appsec-auditor` / `egm-codebase-details` / `factory-verifier`:**
  * `appsec-auditor` (`flash`): **PASS** (0 `CRITICAL`, 0 `HIGH`, 0 `MEDIUM`, 0 `LOW` pendentes após hardening de `spawnIsolatedEmbeddedServer`, `PLAN_MODE_PERMISSION_RULESET`, `path-guard.ts`, parser de flags globais `git` e `redactError`).
  * `test-critic` (`flash`): **PASS** (todas as 7 suítes do Slice 2 auditadas e executadas com cobertura de *Tests as Data*, concorrência Git real, SSE fail-closed, `maxSteps`, `ollama`, e zero `try/catch` em testes).
  * `egm-codebase-details` (`inherit`): **PASS** (conformidade integral com Dossiê, Spec v1.1, fronteiras do monorepo e exports browser-safe sem `node:*` em `./stuck-detector` e `./redact`).
  * `factory-verifier` (`inherit`): **PASS** (`20/20` tarefas `--force` verdes, varredura estática zero `any`/`as unknown as`/`ee/`, aderência integral ao DoD).
* **Commit / Branch:** `feat/slice-02-opencode-bridge-stuck-detector` (empilhada sobre `feat/slice-01-hierarchy-vault-ui`)
